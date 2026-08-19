package handler

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
)

const (
	miniMaxH3HubModel          = "MiniMaxAI/MiniMax-H3"
	miniMaxH3MaxReferenceBytes = 64 << 20
)

func isMiniMaxH3LocalVideoRequest(channel model.ModelChannel, modelName string) bool {
	if !isMiniMaxH3ModelName(modelName) {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(channel.Protocol), "minimax-h3") {
		return true
	}
	text := strings.ToLower(strings.Join([]string{channel.ID, channel.Name, channel.BaseURL, channel.Remark}, " "))
	return strings.Contains(text, "local-minimax-h3") ||
		strings.Contains(text, "minimax h3") ||
		strings.Contains(text, "minimax-h3") ||
		strings.Contains(text, "127.0.0.1:7860") ||
		strings.Contains(text, "localhost:7860") ||
		strings.Contains(text, "127.0.0.1:30010") ||
		strings.Contains(text, "127.0.0.1:30011") ||
		strings.Contains(text, "localhost:30010") ||
		strings.Contains(text, "localhost:30011")
}

func normalizeMiniMaxH3VideoBody(body []byte, contentType string, modelName string) ([]byte, string, error) {
	payload, err := readMiniMaxH3Payload(body, contentType)
	if err != nil {
		return body, contentType, err
	}
	if strings.TrimSpace(toStringSafe(payload["prompt"])) == "" {
		return body, contentType, errors.New("MiniMax-H3 request missing prompt")
	}
	if strings.TrimSpace(toStringSafe(payload["task"])) != "" {
		payload["model"] = miniMaxH3HubModel
		encoded, err := json.Marshal(payload)
		if err != nil {
			return body, contentType, err
		}
		return encoded, "application/json", nil
	}

	referenceMode := isMiniMaxH3ReferenceModel(modelName) || hasAnyMiniMaxH3Reference(payload, []string{"video_reference", "video_reference[]", "video_url", "video_urls", "reference_video_url", "reference_video_urls", "audio_reference", "audio_reference[]", "audio_url", "audio_urls", "reference_audio_url", "reference_audio_urls"})
	conditions := make([]map[string]any, 0, 4)
	if referenceMode {
		for _, uri := range miniMaxH3StringValues(payload, "input_reference", "input_reference[]", "image_url", "image_urls", "reference_image", "reference_images", "reference_image_url", "reference_image_urls") {
			conditions = append(conditions, miniMaxH3Condition("image", uri, "reference", nil))
		}
		for _, uri := range miniMaxH3StringValues(payload, "video_reference", "video_reference[]", "video_url", "video_urls", "reference_video", "reference_videos", "reference_video_url", "reference_video_urls") {
			conditions = append(conditions, miniMaxH3Condition("video", uri, "reference", nil))
		}
		for _, uri := range miniMaxH3StringValues(payload, "audio_reference", "audio_reference[]", "audio_url", "audio_urls", "reference_audio", "reference_audios", "reference_audio_url", "reference_audio_urls") {
			conditions = append(conditions, miniMaxH3Condition("audio", uri, "reference", nil))
		}
	} else {
		firstFrame := miniMaxH3FirstValue(payload, "first_frame_url", "first_frame_image")
		lastFrame := miniMaxH3FirstValue(payload, "last_frame_url", "last_frame_image")
		if firstFrame != "" {
			frameIndex := 0
			conditions = append(conditions, miniMaxH3Condition("image", firstFrame, "keyframe", &frameIndex))
		}
		if lastFrame != "" {
			frameIndex := -1
			conditions = append(conditions, miniMaxH3Condition("image", lastFrame, "keyframe", &frameIndex))
		}
		if len(conditions) == 0 {
			for index, uri := range miniMaxH3StringValues(payload, "input_reference", "input_reference[]", "image_url", "image_urls", "reference_image", "reference_images", "reference_image_url", "reference_image_urls") {
				if index >= 2 {
					break
				}
				frameIndex := 0
				if index == 1 {
					frameIndex = -1
				}
				conditions = append(conditions, miniMaxH3Condition("image", uri, "keyframe", &frameIndex))
			}
		}
	}

	duration := normalizeMiniMaxH3Duration(firstNonEmpty(toStringSafe(payload["duration"]), toStringSafe(payload["seconds"])))
	task := "t2va"
	if referenceMode {
		task = "ref2va"
	} else if len(conditions) > 0 {
		task = "fl2va"
	}
	request := map[string]any{
		"model":                  miniMaxH3HubModel,
		"prompt":                 strings.TrimSpace(toStringSafe(payload["prompt"])),
		"seconds":                duration,
		"task":                   task,
		"conditions":             conditions,
		"target":                 miniMaxH3Target(payload, duration, len(conditions) > 0 && !referenceMode),
		"num_outputs_per_prompt": miniMaxH3IntInRange(firstNonEmpty(toStringSafe(payload["num_outputs_per_prompt"]), toStringSafe(payload["n"])), 1, 1, 10),
		"seed":                   miniMaxH3IntInRange(toStringSafe(payload["seed"]), 0, 0, 2147483647),
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		return body, contentType, err
	}
	return encoded, "application/json", nil
}

func transformMiniMaxH3StatusResponse(payload []byte, request *http.Request) ([]byte, bool) {
	var record map[string]any
	if len(payload) == 0 || json.Unmarshal(payload, &record) != nil {
		return nil, false
	}
	status := strings.ToLower(strings.TrimSpace(firstNonEmpty(toStringSafe(record["status"]), toStringSafe(record["state"]))))
	if status != "completed" && status != "complete" && status != "succeeded" && status != "success" && status != "done" {
		return nil, false
	}
	if findFirstHTTPURL(record) != "" {
		return nil, false
	}
	contentURL := strings.TrimRight(request.URL.String(), "/") + "/content"
	record["url"] = contentURL
	record["video_url"] = contentURL
	record["data"] = []map[string]any{{"url": contentURL}}
	encoded, err := json.Marshal(record)
	if err != nil {
		return nil, false
	}
	return encoded, true
}

func readMiniMaxH3Payload(body []byte, contentType string) (map[string]any, error) {
	payload := map[string]any{}
	if !strings.HasPrefix(strings.ToLower(contentType), "multipart/form-data") {
		_ = json.Unmarshal(body, &payload)
		return payload, nil
	}
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return nil, err
	}
	form, err := multipart.NewReader(bytes.NewReader(body), params["boundary"]).ReadForm(miniMaxH3MaxReferenceBytes)
	if err != nil {
		return nil, err
	}
	defer form.RemoveAll()
	for key, values := range form.Value {
		if len(values) == 1 {
			payload[key] = values[0]
		} else if len(values) > 1 {
			items := make([]any, 0, len(values))
			for _, value := range values {
				items = append(items, value)
			}
			payload[key] = items
		}
	}
	return payload, mergeMiniMaxH3FormFiles(payload, form.File)
}

func mergeMiniMaxH3FormFiles(payload map[string]any, files map[string][]*multipart.FileHeader) error {
	for key, headers := range files {
		values := make([]any, 0, len(headers))
		for _, header := range headers {
			dataURI, err := miniMaxH3FormFileDataURI(header)
			if err != nil {
				return err
			}
			values = append(values, dataURI)
		}
		if existing, ok := payload[key]; ok {
			values = append(miniMaxH3StringAnyValues(existing), values...)
		}
		if len(values) == 1 {
			payload[key] = values[0]
		} else if len(values) > 1 {
			payload[key] = values
		}
	}
	return nil
}

func miniMaxH3FormFileDataURI(header *multipart.FileHeader) (string, error) {
	file, err := header.Open()
	if err != nil {
		return "", err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, miniMaxH3MaxReferenceBytes+1))
	if err != nil {
		return "", err
	}
	if len(data) == 0 {
		return "", fmt.Errorf("MiniMax-H3 reference file is empty: %s", header.Filename)
	}
	if len(data) > miniMaxH3MaxReferenceBytes {
		return "", fmt.Errorf("MiniMax-H3 reference file is too large: %s", header.Filename)
	}
	contentType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = http.DetectContentType(data)
	}
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func miniMaxH3Target(payload map[string]any, duration int, autoAspect bool) map[string]any {
	aspect := "auto"
	if !autoAspect {
		aspect = normalizeMiniMaxH3Aspect(firstNonEmpty(toStringSafe(payload["aspect_ratio"]), toStringSafe(payload["ratio"]), toStringSafe(payload["size"])))
	}
	return map[string]any{
		"short_edge":       768,
		"aspect_ratio":     aspect,
		"duration_seconds": duration,
	}
}

func miniMaxH3Condition(kind string, uri string, role string, frameIndex *int) map[string]any {
	condition := map[string]any{
		"type": kind,
		"uri":  uri,
		"role": role,
	}
	if frameIndex != nil {
		condition["frame_index"] = *frameIndex
	}
	return condition
}

func miniMaxH3StringValues(payload map[string]any, keys ...string) []string {
	result := make([]string, 0)
	seen := map[string]bool{}
	for _, key := range keys {
		for _, value := range miniMaxH3StringAnyValues(payload[key]) {
			text := strings.TrimSpace(toStringSafe(value))
			if text == "" || seen[text] {
				continue
			}
			seen[text] = true
			result = append(result, text)
		}
	}
	return result
}

func miniMaxH3StringAnyValues(value any) []any {
	switch typed := value.(type) {
	case nil:
		return nil
	case []any:
		return typed
	case []string:
		items := make([]any, 0, len(typed))
		for _, item := range typed {
			items = append(items, item)
		}
		return items
	default:
		return []any{typed}
	}
}

func miniMaxH3FirstValue(payload map[string]any, keys ...string) string {
	values := miniMaxH3StringValues(payload, keys...)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func hasAnyMiniMaxH3Reference(payload map[string]any, keys []string) bool {
	for _, key := range keys {
		if len(miniMaxH3StringValues(payload, key)) > 0 {
			return true
		}
	}
	return false
}

func isMiniMaxH3ModelName(modelName string) bool {
	model := strings.ToLower(strings.TrimSpace(modelName))
	model = strings.ReplaceAll(model, "_", "-")
	model = strings.ReplaceAll(model, "/", "-")
	return model == "minimax-h3" || strings.HasPrefix(model, "minimax-h3-")
}

func isMiniMaxH3ReferenceModel(modelName string) bool {
	model := strings.ToLower(strings.TrimSpace(modelName))
	return strings.Contains(strings.ReplaceAll(model, "/", "-"), "reference-to-video")
}

func normalizeMiniMaxH3Duration(value string) int {
	duration := miniMaxH3IntInRange(value, 5, 4, 15)
	if duration == 0 {
		return 5
	}
	return duration
}

func miniMaxH3IntInRange(value string, fallback int, minValue int, maxValue int) int {
	parsed, err := strconv.Atoi(strings.TrimSuffix(strings.TrimSpace(strings.ToLower(value)), "s"))
	if err != nil {
		parsed = fallback
	}
	if parsed < minValue {
		return minValue
	}
	if maxValue > 0 && parsed > maxValue {
		return maxValue
	}
	return parsed
}

func normalizeMiniMaxH3Aspect(value string) string {
	value = strings.ReplaceAll(strings.TrimSpace(strings.ToLower(value)), " ", "")
	switch value {
	case "", "auto":
		return "auto"
	case "21:9", "16:9", "4:3", "1:1", "3:4", "9:16":
		return value
	}
	if width, height, ok := parseMiniMaxH3Size(value); ok {
		divisor := miniMaxH3GCD(width, height)
		return fmt.Sprintf("%d:%d", width/divisor, height/divisor)
	}
	return "16:9"
}

func parseMiniMaxH3Size(value string) (int, int, bool) {
	parts := strings.Split(value, "x")
	if len(parts) != 2 {
		return 0, 0, false
	}
	width, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil || width <= 0 {
		return 0, 0, false
	}
	height, err := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err != nil || height <= 0 {
		return 0, 0, false
	}
	return width, height, true
}

func miniMaxH3GCD(a int, b int) int {
	if b == 0 {
		if a < 0 {
			return -a
		}
		if a == 0 {
			return 1
		}
		return a
	}
	return miniMaxH3GCD(b, a%b)
}
