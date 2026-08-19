package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTopazDecoderForInputDetectsCommonVideoCodecs(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{name: "H3 H264 MP4", content: "isomiso2avc1mp41", want: "h264_cuvid"},
		{name: "HEVC MP4", content: "isomhvc1", want: "hevc_cuvid"},
		{name: "AV1 MP4", content: "isomav01", want: "av1_cuvid"},
		{name: "Unknown", content: "isommp42", want: ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "source.mp4")
			if err := os.WriteFile(path, []byte(test.content), 0o600); err != nil {
				t.Fatalf("write input: %v", err)
			}
			if got := topazDecoderForInput(path); got != test.want {
				t.Fatalf("topazDecoderForInput() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestBuildTopazCommandDisablesModelDownloadAndUsesDetectedDecoder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "h3-output.mp4")
	if err := os.WriteFile(path, []byte("isomiso2avc1mp41"), 0o600); err != nil {
		t.Fatalf("write input: %v", err)
	}
	command := buildTopazCommand(
		topazInstallation{ffmpeg: "topaz-ffmpeg.exe"},
		path,
		filepath.Join(t.TempDir(), "output.mp4"),
		TopazVideoTaskInput{Model: "prob-4", Quality: "balanced", Interpolation: "none", Slowdown: "1x"},
		topazProbe{FPS: 24},
		1910,
		1080,
	)
	joined := ""
	for _, argument := range command {
		joined += argument + "\n"
	}
	if !containsTopazArgumentPair(command, "-c:v", "h264_cuvid") {
		t.Fatalf("command does not use NVIDIA H.264 decoder: %#v", command)
	}
	if !containsTopazArgumentPair(command, "-c:v", "h264_nvenc") {
		t.Fatalf("command does not use NVIDIA H.264 encoder: %#v", command)
	}
	if !strings.Contains(joined, "download=0") {
		t.Fatalf("command must keep Topaz model downloads disabled: %#v", command)
	}
}

func TestValidateTopazTaskInputRequiresBrowserVideoDimensions(t *testing.T) {
	err := validateTopazTaskInput(
		TopazVideoTaskInput{
			InputID:       "0e4f21e8-7890-4d4c-8d6d-39e3ed49d71b",
			Model:         "prob-4",
			Target:        "1080p",
			Quality:       "balanced",
			Interpolation: "none",
			Slowdown:      "1x",
		},
		[]TopazVideoModel{{ID: "prob-4"}},
	)
	if err == nil || !strings.Contains(err.Error(), "分辨率") {
		t.Fatalf("missing video dimensions must be rejected before any ffprobe fallback, got %v", err)
	}
}

func containsTopazArgumentPair(arguments []string, option, value string) bool {
	for index := 0; index+1 < len(arguments); index++ {
		if arguments[index] == option && arguments[index+1] == value {
			return true
		}
	}
	return false
}
