package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/tigerowo/infinite-canvas/service"
)

func LocalTopazVideoCapabilities(w http.ResponseWriter, _ *http.Request) {
	OK(w, service.TopazVideoCapabilitiesInfo())
}

func UploadLocalTopazVideo(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 5<<30+1)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		Fail(w, "Topaz 视频上传格式不正确或文件过大")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		Fail(w, "请选择需要高清处理的视频")
		return
	}
	defer file.Close()
	result, err := service.CreateTopazVideoUpload(file, header.Filename, header.Header.Get("Content-Type"))
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, result)
}

func CreateLocalTopazVideoTask(w http.ResponseWriter, r *http.Request) {
	var input service.TopazVideoTaskInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		Fail(w, "Topaz 任务参数格式错误")
		return
	}
	task, err := service.CreateTopazVideoTask(input)
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, task)
}

func LocalTopazVideoTask(w http.ResponseWriter, _ *http.Request, id string) {
	task, err := service.GetTopazVideoTask(strings.TrimSpace(id))
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, task)
}

func CancelLocalTopazVideoTask(w http.ResponseWriter, _ *http.Request, id string) {
	task, err := service.CancelTopazVideoTask(strings.TrimSpace(id))
	if err != nil {
		Fail(w, err.Error())
		return
	}
	OK(w, task)
}

func LocalTopazVideoFile(w http.ResponseWriter, r *http.Request, id string) {
	file, info, err := service.OpenTopazVideoOutput(strings.TrimSpace(id))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, "topaz-upscaled.mp4", info.ModTime(), file)
}
