package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	topazVideoVendor          = "Topaz Labs LLC"
	topazVideoMaxUploadBytes  = int64(5 << 30)
	topazVideoOutputExtension = ".mp4"
)

var topazVideoIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type TopazVideoModel struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type TopazVideoCapabilities struct {
	Installed    bool              `json:"installed"`
	Ready        bool              `json:"ready"`
	Version      string            `json:"version,omitempty"`
	Models       []TopazVideoModel `json:"models"`
	DefaultModel string            `json:"defaultModel,omitempty"`
	Error        string            `json:"error,omitempty"`
}

type TopazVideoTaskInput struct {
	InputID        string `json:"inputId"`
	Model          string `json:"model"`
	Target         string `json:"target"`
	Quality        string `json:"quality"`
	Interpolation  string `json:"interpolation"`
	Slowdown       string `json:"slowdown"`
	SourceWidth    int    `json:"sourceWidth"`
	SourceHeight   int    `json:"sourceHeight"`
	SourceDuration int64  `json:"sourceDurationMs"`
}

type TopazVideoTask struct {
	ID             string  `json:"id"`
	Status         string  `json:"status"`
	Progress       float64 `json:"progress"`
	Message        string  `json:"message,omitempty"`
	Error          string  `json:"error,omitempty"`
	StartedAt      string  `json:"startedAt,omitempty"`
	CompletedAt    string  `json:"completedAt,omitempty"`
	DurationMs     int64   `json:"durationMs,omitempty"`
	OutputURL      string  `json:"outputUrl,omitempty"`
	OutputWidth    int     `json:"outputWidth,omitempty"`
	OutputHeight   int     `json:"outputHeight,omitempty"`
	OutputBytes    int64   `json:"outputBytes,omitempty"`
	OutputMimeType string  `json:"outputMimeType,omitempty"`

	input  TopazVideoTaskInput
	cancel context.CancelFunc
}

type TopazVideoUpload struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Bytes    int64  `json:"bytes"`
	MimeType string `json:"mimeType"`
}

type topazInstallation struct {
	root         string
	ffmpeg       string
	modelDir     string
	modelDataDir string
	version      string
	ready        bool
	error        string
}

type topazProbe struct {
	Width    int
	Height   int
	Duration float64
	FPS      float64
}

type topazVideoManager struct {
	mu    sync.RWMutex
	tasks map[string]*TopazVideoTask
	queue chan struct{}
}

var localTopazVideo = &topazVideoManager{tasks: make(map[string]*TopazVideoTask), queue: make(chan struct{}, 1)}

// TopazVideoCapabilitiesInfo reads the local installation only. It never contacts Topaz services.
func TopazVideoCapabilitiesInfo() TopazVideoCapabilities {
	installation := discoverTopazInstallation()
	models := discoverTopazModels(installation.modelDir)
	capabilities := TopazVideoCapabilities{
		Installed:    installation.ffmpeg != "",
		Ready:        installation.ready,
		Version:      installation.version,
		Models:       models,
		DefaultModel: preferredTopazModel(models),
		Error:        installation.error,
	}
	if capabilities.Ready && len(models) == 0 {
		capabilities.Ready = false
		capabilities.Error = "未找到可用的 Topaz 增强模型"
	}
	return capabilities
}

func CreateTopazVideoUpload(reader io.Reader, filename, mimeType string) (TopazVideoUpload, error) {
	ext := strings.ToLower(strings.TrimSpace(filepath.Ext(filename)))
	if !isTopazInputExtension(ext) {
		return TopazVideoUpload{}, errors.New("Topaz 仅支持 MP4、MOV、MKV 或 WebM 视频")
	}
	if err := os.MkdirAll(topazVideoInputDir(), 0o755); err != nil {
		return TopazVideoUpload{}, errors.New("无法创建 Topaz 本地输入目录")
	}
	id := uuid.NewString()
	targetPath := filepath.Join(topazVideoInputDir(), id+ext)
	target, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return TopazVideoUpload{}, errors.New("无法保存 Topaz 输入视频")
	}
	bytes, copyErr := io.Copy(target, io.LimitReader(reader, topazVideoMaxUploadBytes+1))
	closeErr := target.Close()
	if copyErr != nil || closeErr != nil || bytes <= 0 || bytes > topazVideoMaxUploadBytes {
		_ = os.Remove(targetPath)
		if bytes > topazVideoMaxUploadBytes {
			return TopazVideoUpload{}, errors.New("Topaz 输入视频超过 5GB 限制")
		}
		return TopazVideoUpload{}, errors.New("保存 Topaz 输入视频失败")
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "video/") {
		mimeType = topazMimeType(ext)
	}
	return TopazVideoUpload{ID: id, Name: filepath.Base(filename), Bytes: bytes, MimeType: mimeType}, nil
}

func CreateTopazVideoTask(input TopazVideoTaskInput) (TopazVideoTask, error) {
	installation := discoverTopazInstallation()
	models := discoverTopazModels(installation.modelDir)
	if !installation.ready {
		return TopazVideoTask{}, errors.New(installation.error)
	}
	if len(models) == 0 {
		return TopazVideoTask{}, errors.New("未找到可用的 Topaz 增强模型")
	}
	input = normalizeTopazTaskInput(input, preferredTopazModel(models))
	if err := validateTopazTaskInput(input, models); err != nil {
		return TopazVideoTask{}, err
	}
	if _, err := topazInputPath(input.InputID); err != nil {
		return TopazVideoTask{}, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	task := &TopazVideoTask{
		ID:       uuid.NewString(),
		Status:   "queued",
		Progress: 0,
		Message:  "等待本机 Topaz Video",
		input:    input,
		cancel:   cancel,
	}
	localTopazVideo.mu.Lock()
	localTopazVideo.tasks[task.ID] = task
	localTopazVideo.mu.Unlock()
	go localTopazVideo.runTask(ctx, task.ID, installation, models)
	return publicTopazTask(task), nil
}

func GetTopazVideoTask(id string) (TopazVideoTask, error) {
	localTopazVideo.mu.RLock()
	task, ok := localTopazVideo.tasks[id]
	localTopazVideo.mu.RUnlock()
	if !ok {
		return TopazVideoTask{}, errors.New("Topaz 任务不存在或服务已重启")
	}
	return publicTopazTask(task), nil
}

func CancelTopazVideoTask(id string) (TopazVideoTask, error) {
	localTopazVideo.mu.Lock()
	task, ok := localTopazVideo.tasks[id]
	if !ok {
		localTopazVideo.mu.Unlock()
		return TopazVideoTask{}, errors.New("Topaz 任务不存在")
	}
	if task.Status == "succeeded" || task.Status == "failed" || task.Status == "canceled" {
		copy := publicTopazTask(task)
		localTopazVideo.mu.Unlock()
		return copy, nil
	}
	task.Status = "canceling"
	task.Message = "正在取消本机 Topaz 任务"
	cancel := task.cancel
	copy := publicTopazTask(task)
	localTopazVideo.mu.Unlock()
	cancel()
	return copy, nil
}

func OpenTopazVideoOutput(id string) (*os.File, os.FileInfo, error) {
	if !topazVideoIDPattern.MatchString(strings.ToLower(id)) {
		return nil, nil, os.ErrNotExist
	}
	path := filepath.Join(topazVideoOutputDir(), strings.ToLower(id)+topazVideoOutputExtension)
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		_ = file.Close()
		return nil, nil, os.ErrNotExist
	}
	return file, info, nil
}

func (manager *topazVideoManager) runTask(ctx context.Context, taskID string, installation topazInstallation, models []TopazVideoModel) {
	select {
	case manager.queue <- struct{}{}:
		defer func() { <-manager.queue }()
	case <-ctx.Done():
		manager.finishCanceled(taskID)
		return
	}

	manager.updateTask(taskID, func(task *TopazVideoTask) {
		task.Status = "probing"
		task.Message = "正在读取输入视频"
		task.StartedAt = time.Now().Format(time.RFC3339Nano)
	})
	input, ok := manager.taskInput(taskID)
	if !ok {
		return
	}
	inputPath, err := topazInputPath(input.InputID)
	if err != nil {
		manager.finishFailed(taskID, err)
		return
	}
	// Width and height are captured by the browser's video element before upload.
	// Never execute Topaz's bundled ffprobe here: on this machine it can crash at
	// process startup and display a Windows error dialog for otherwise valid MP4s.
	probe := topazProbe{Width: input.SourceWidth, Height: input.SourceHeight, Duration: float64(input.SourceDuration) / 1000, FPS: 24}
	width, height, err := resolveTopazTargetDimensions(probe.Width, probe.Height, input.Target)
	if err != nil {
		manager.finishFailed(taskID, err)
		return
	}
	if err := os.MkdirAll(topazVideoOutputDir(), 0o755); err != nil {
		manager.finishFailed(taskID, errors.New("无法创建 Topaz 输出目录"))
		return
	}
	tempPath := filepath.Join(topazVideoOutputDir(), taskID+".partial"+topazVideoOutputExtension)
	outputPath := filepath.Join(topazVideoOutputDir(), taskID+topazVideoOutputExtension)
	_ = os.Remove(tempPath)
	_ = os.Remove(outputPath)

	manager.updateTask(taskID, func(task *TopazVideoTask) {
		task.Status = "running"
		task.Message = fmt.Sprintf("Topaz 正在生成 %d×%d 高清视频", width, height)
		task.OutputWidth = width
		task.OutputHeight = height
	})
	command := buildTopazCommand(installation, inputPath, tempPath, input, probe, width, height)
	if err := manager.executeTopazCommand(ctx, taskID, command, installation, probe.Duration); err != nil {
		_ = os.Remove(tempPath)
		if errors.Is(err, context.Canceled) {
			manager.finishCanceled(taskID)
		} else {
			manager.finishFailed(taskID, err)
		}
		return
	}
	info, err := os.Stat(tempPath)
	if err != nil || info.Size() <= 0 {
		manager.finishFailed(taskID, errors.New("Topaz 未生成有效的视频文件"))
		return
	}
	if err := os.Rename(tempPath, outputPath); err != nil {
		manager.finishFailed(taskID, errors.New("Topaz 输出视频保存失败"))
		return
	}
	manager.updateTask(taskID, func(task *TopazVideoTask) {
		completed := time.Now()
		started, _ := time.Parse(time.RFC3339Nano, task.StartedAt)
		task.Status = "succeeded"
		task.Progress = 100
		task.Message = "本机 Topaz 高清处理完成"
		task.CompletedAt = completed.Format(time.RFC3339Nano)
		task.DurationMs = completed.Sub(started).Milliseconds()
		task.OutputURL = "/api/local-topaz-video/files/" + task.ID
		task.OutputBytes = info.Size()
		task.OutputMimeType = "video/mp4"
	})
}

func (manager *topazVideoManager) executeTopazCommand(ctx context.Context, taskID string, args []string, installation topazInstallation, duration float64) error {
	if len(args) == 0 {
		return errors.New("Topaz 命令无效")
	}
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Dir = installation.root
	cmd.Env = append(os.Environ(), "TVAI_MODEL_DIR="+installation.modelDir, "TVAI_MODEL_DATA_DIR="+installation.modelDataDir)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return errors.New("无法读取 Topaz 处理进度")
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return errors.New("无法读取 Topaz 错误信息")
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("无法启动本机 Topaz Video：%w", err)
	}
	var stderrLines []string
	var stderrMu sync.Mutex
	var readers sync.WaitGroup
	readers.Add(2)
	go func() {
		defer readers.Done()
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			manager.applyProgress(taskID, scanner.Text(), duration)
		}
	}()
	go func() {
		defer readers.Done()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			stderrMu.Lock()
			stderrLines = append(stderrLines, line)
			if len(stderrLines) > 24 {
				stderrLines = stderrLines[len(stderrLines)-24:]
			}
			stderrMu.Unlock()
		}
	}()
	waitErr := cmd.Wait()
	readers.Wait()
	if ctx.Err() != nil {
		return context.Canceled
	}
	if waitErr != nil {
		stderrMu.Lock()
		detail := humanizeTopazError(stderrLines)
		stderrMu.Unlock()
		return errors.New(detail)
	}
	return nil
}

func (manager *topazVideoManager) applyProgress(id, line string, duration float64) {
	key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
	if !ok {
		return
	}
	manager.updateTask(id, func(task *TopazVideoTask) {
		switch key {
		case "out_time_us", "out_time_ms":
			microseconds, parseErr := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if parseErr == nil && !math.IsNaN(microseconds) && !math.IsInf(microseconds, 0) && duration > 0 {
				if key == "out_time_ms" && microseconds < 1_000_000 {
					microseconds *= 1_000
				}
				task.Progress = math.Max(task.Progress, math.Min(99, microseconds/duration/10_000))
			}
		case "speed":
			if value != "N/A" {
				task.Message = "Topaz 正在本机处理 · " + value
			}
		case "progress":
			if value == "end" {
				task.Progress = 99
			}
		}
	})
}

func (manager *topazVideoManager) taskInput(id string) (TopazVideoTaskInput, bool) {
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	task, ok := manager.tasks[id]
	if !ok {
		return TopazVideoTaskInput{}, false
	}
	return task.input, true
}

func (manager *topazVideoManager) updateTask(id string, update func(*TopazVideoTask)) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if task, ok := manager.tasks[id]; ok {
		update(task)
	}
}

func (manager *topazVideoManager) finishCanceled(id string) {
	manager.updateTask(id, func(task *TopazVideoTask) {
		completed := time.Now()
		started, _ := time.Parse(time.RFC3339Nano, task.StartedAt)
		task.Status = "canceled"
		task.Message = "Topaz 任务已取消"
		task.CompletedAt = completed.Format(time.RFC3339Nano)
		if !started.IsZero() {
			task.DurationMs = completed.Sub(started).Milliseconds()
		}
	})
}

func (manager *topazVideoManager) finishFailed(id string, err error) {
	manager.updateTask(id, func(task *TopazVideoTask) {
		completed := time.Now()
		started, _ := time.Parse(time.RFC3339Nano, task.StartedAt)
		task.Status = "failed"
		task.Error = err.Error()
		task.Message = "Topaz 本机处理失败"
		task.CompletedAt = completed.Format(time.RFC3339Nano)
		if !started.IsZero() {
			task.DurationMs = completed.Sub(started).Milliseconds()
		}
	})
}

func publicTopazTask(task *TopazVideoTask) TopazVideoTask {
	if task == nil {
		return TopazVideoTask{}
	}
	copy := *task
	copy.cancel = nil
	copy.input = TopazVideoTaskInput{}
	return copy
}

func normalizeTopazTaskInput(input TopazVideoTaskInput, defaultModel string) TopazVideoTaskInput {
	input.InputID = strings.ToLower(strings.TrimSpace(input.InputID))
	input.Model = strings.ToLower(strings.TrimSpace(input.Model))
	if input.Model == "" {
		input.Model = defaultModel
	}
	input.Target = strings.ToLower(strings.TrimSpace(input.Target))
	if input.Target == "" {
		input.Target = "1080p"
	}
	input.Quality = strings.ToLower(strings.TrimSpace(input.Quality))
	if input.Quality == "" {
		input.Quality = "balanced"
	}
	input.Interpolation = strings.ToLower(strings.TrimSpace(input.Interpolation))
	if input.Interpolation == "" {
		input.Interpolation = "none"
	}
	input.Slowdown = strings.ToLower(strings.TrimSpace(input.Slowdown))
	if input.Slowdown == "" {
		input.Slowdown = "1x"
	}
	input.SourceWidth = max(0, input.SourceWidth)
	input.SourceHeight = max(0, input.SourceHeight)
	input.SourceDuration = max(0, input.SourceDuration)
	return input
}

func validateTopazTaskInput(input TopazVideoTaskInput, models []TopazVideoModel) error {
	if !topazVideoIDPattern.MatchString(input.InputID) {
		return errors.New("Topaz 输入视频标识无效")
	}
	if !regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,40}$`).MatchString(input.Model) {
		return errors.New("Topaz 模型标识格式不正确")
	}
	found := false
	for _, model := range models {
		if model.ID == input.Model {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("当前 Topaz 安装中不存在模型：%s", input.Model)
	}
	if input.Target != "1080p" && input.Target != "1440p" && input.Target != "2160p" {
		return errors.New("Topaz 输出分辨率必须是 1080P、2K 或 4K")
	}
	if input.Quality != "high" && input.Quality != "balanced" && input.Quality != "compact" {
		return errors.New("Topaz 输出质量无效")
	}
	if input.Interpolation != "none" && input.Interpolation != "2x" && input.Interpolation != "4x" {
		return errors.New("Topaz 补帧模式无效")
	}
	if input.Slowdown != "1x" && input.Slowdown != "2x" && input.Slowdown != "4x" {
		return errors.New("Topaz 慢放倍数无效")
	}
	if input.SourceWidth < 1 || input.SourceHeight < 1 {
		return errors.New("无法读取输入视频分辨率，请重新加载视频后重试")
	}
	if input.SourceWidth > 16384 || input.SourceHeight > 16384 {
		return errors.New("输入视频分辨率超过 Topaz 支持范围")
	}
	return nil
}

func discoverTopazInstallation() topazInstallation {
	installation := topazInstallation{}
	for _, root := range topazInstallCandidates() {
		ffmpeg := filepath.Join(root, "ffmpeg.exe")
		if isRegularFile(ffmpeg) {
			installation.root = root
			installation.ffmpeg = ffmpeg
			break
		}
	}
	if installation.ffmpeg == "" {
		installation.error = "未检测到本机 Topaz Video 安装"
		return installation
	}
	installation.modelDir = findTopazModelDefinitionDir(installation.root)
	installation.modelDataDir = findTopazModelDataDir(installation.root)
	valid, version := verifyTopazSignature(installation.ffmpeg)
	installation.version = version
	if !valid {
		installation.error = "Topaz FFmpeg 数字签名无效，已阻止执行"
		return installation
	}
	if installation.modelDir == "" {
		installation.error = "未找到 Topaz 模型定义目录"
		return installation
	}
	if installation.modelDataDir == "" {
		installation.error = "未找到已下载的 Topaz 模型权重"
		return installation
	}
	if !topazFilterAvailable(installation.ffmpeg) {
		installation.error = "当前 Topaz FFmpeg 不包含 tvai_up 滤镜"
		return installation
	}
	installation.ready = true
	return installation
}

func topazInstallCandidates() []string {
	values := []string{strings.TrimSpace(os.Getenv("TOPAZ_VIDEO_DIR")), `D:\Program Files\Topaz Labs LLC\Topaz Video`}
	for _, environment := range []string{"ProgramW6432", "ProgramFiles"} {
		if root := strings.TrimSpace(os.Getenv(environment)); root != "" {
			values = append(values, filepath.Join(root, "Topaz Labs LLC", "Topaz Video"), filepath.Join(root, "Topaz Labs LLC", "Topaz Video AI"))
		}
	}
	return uniquePaths(values)
}

func topazProgramDataCandidates(installRoot string) []string {
	values := []string{strings.TrimSpace(os.Getenv("TVAI_MODEL_DIR")), strings.TrimSpace(os.Getenv("TVAI_MODEL_DATA_DIR"))}
	for _, root := range []string{strings.TrimSpace(os.Getenv("PROGRAMDATA")), `C:\ProgramData`, `D:\ProgramData`} {
		if root == "" {
			continue
		}
		values = append(values, filepath.Join(root, "Topaz Labs LLC", "Topaz Video", "models"), filepath.Join(root, "Topaz Labs LLC", "Topaz Video AI", "models"))
	}
	if volume := filepath.VolumeName(installRoot); volume != "" {
		values = append(values, filepath.Join(volume+`\`, "ProgramData", "Topaz Labs LLC", "Topaz Video", "models"), filepath.Join(volume+`\`, "ProgramData", "Topaz Labs LLC", "Topaz Video AI", "models"))
	}
	return uniquePaths(values)
}

func findTopazModelDefinitionDir(installRoot string) string {
	for _, candidate := range topazProgramDataCandidates(installRoot) {
		if isRegularFile(filepath.Join(candidate, "tvai.tz")) {
			return candidate
		}
	}
	return ""
}

func findTopazModelDataDir(installRoot string) string {
	for _, candidate := range topazProgramDataCandidates(installRoot) {
		if containsTopazModelData(candidate) {
			return candidate
		}
	}
	return ""
}

func containsTopazModelData(root string) bool {
	found := false
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || found {
			return nil
		}
		if strings.EqualFold(filepath.Ext(entry.Name()), ".tz3") {
			if info, statErr := entry.Info(); statErr == nil && info.Size() > 1<<20 {
				found = true
			}
		}
		return nil
	})
	return found
}

func verifyTopazSignature(path string) (bool, string) {
	if runtime.GOOS != "windows" {
		return false, ""
	}
	const targetVariable = "WXHB_TOPAZ_SIGNATURE_TARGET"
	script := "Import-Module Microsoft.PowerShell.Security -ErrorAction Stop;$p=[Environment]::GetEnvironmentVariable('WXHB_TOPAZ_SIGNATURE_TARGET','Process');$s=Get-AuthenticodeSignature -LiteralPath $p;$v=(Get-Item -LiteralPath $p).VersionInfo.ProductVersion;[pscustomobject]@{Status=[string]$s.Status;Signer=[string]$s.SignerCertificate.Subject;Version=[string]$v}|ConvertTo-Json -Compress"
	powershell := filepath.Join(strings.TrimSpace(os.Getenv("SystemRoot")), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	if !isRegularFile(powershell) {
		powershell = `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
	}
	command := exec.Command(powershell, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script)
	command.Env = append(
		os.Environ(),
		targetVariable+"="+path,
		`PSModulePath=C:\Program Files\WindowsPowerShell\Modules;C:\Windows\System32\WindowsPowerShell\v1.0\Modules`,
	)
	output, err := command.Output()
	if err != nil {
		return false, ""
	}
	var result struct {
		Status  string
		Signer  string
		Version string
	}
	if json.Unmarshal(output, &result) != nil {
		return false, ""
	}
	return strings.EqualFold(strings.TrimSpace(result.Status), "Valid") && strings.Contains(strings.ToLower(result.Signer), strings.ToLower(topazVideoVendor)), strings.TrimSpace(result.Version)
}

func topazFilterAvailable(ffmpeg string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-filters").CombinedOutput()
	return err == nil && regexp.MustCompile(`(?m)\btvai_up\b`).Match(output)
}

func discoverTopazModels(modelDir string) []TopazVideoModel {
	if modelDir == "" {
		return nil
	}
	entries, err := os.ReadDir(modelDir)
	if err != nil {
		return nil
	}
	labels := map[string]TopazVideoModel{
		"prob": {Name: "Proteus", Description: "通用精细增强"},
		"iris": {Name: "Iris", Description: "人脸与低清素材"},
		"rhea": {Name: "Rhea", Description: "高质量通用增强"},
		"ahq":  {Name: "Artemis HQ", Description: "高质量实拍"},
		"amq":  {Name: "Artemis MQ", Description: "中等质量素材"},
		"alq":  {Name: "Artemis LQ", Description: "低质量素材"},
		"aaa":  {Name: "Artemis AA", Description: "锯齿与摩尔纹"},
		"gcg":  {Name: "Gaia CG", Description: "动画与图形"},
		"ghq":  {Name: "Gaia HQ", Description: "高质量实拍"},
		"nyx":  {Name: "Nyx", Description: "降噪"},
	}
	allowed := map[string]bool{"aaa": true, "ahq": true, "alq": true, "alqs": true, "amq": true, "amqs": true, "ddv": true, "dtd": true, "dtds": true, "dtv": true, "dtvs": true, "gcg": true, "ghq": true, "iris": true, "nyx": true, "prob": true, "rhea": true, "thd": true, "thf": true, "thm": true}
	models := make([]TopazVideoModel, 0)
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".json") {
			continue
		}
		id := strings.ToLower(strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())))
		prefix := strings.SplitN(id, "-", 2)[0]
		if !allowed[prefix] {
			continue
		}
		label, ok := labels[prefix]
		if !ok {
			label = TopazVideoModel{Name: strings.ToUpper(prefix), Description: "视频增强"}
		}
		label.ID = id
		if dash := strings.LastIndex(id, "-"); dash >= 0 {
			label.Name += " " + id[dash+1:]
		}
		models = append(models, label)
	}
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
	return models
}

func preferredTopazModel(models []TopazVideoModel) string {
	for _, candidate := range []string{"prob-4", "prob-3", "prob-2", "amq-13", "ahq-12"} {
		for _, model := range models {
			if model.ID == candidate {
				return candidate
			}
		}
	}
	if len(models) > 0 {
		return models[0].ID
	}
	return "prob-4"
}

func resolveTopazTargetDimensions(width, height int, target string) (int, int, error) {
	if width < 1 || height < 1 {
		return 0, 0, errors.New("无法读取输入视频尺寸")
	}
	shortEdge := map[string]int{"1080p": 1080, "1440p": 1440, "2160p": 2160}[target]
	if shortEdge == 0 {
		return 0, 0, errors.New("不支持的 Topaz 输出分辨率")
	}
	outputWidth, outputHeight := shortEdge, shortEdge
	if width >= height {
		outputHeight = shortEdge
		outputWidth = evenDimension(float64(width) * float64(shortEdge) / float64(height))
	} else {
		outputWidth = shortEdge
		outputHeight = evenDimension(float64(height) * float64(shortEdge) / float64(width))
	}
	if outputWidth > 16384 || outputHeight > 16384 {
		return 0, 0, errors.New("计算后的 Topaz 输出尺寸超过 16384 像素")
	}
	return outputWidth, outputHeight, nil
}

func buildTopazCommand(installation topazInstallation, inputPath, outputPath string, input TopazVideoTaskInput, probe topazProbe, width, height int) []string {
	filters := []string{fmt.Sprintf("tvai_up=model=%s:scale=0:w=%d:h=%d:preblur=0:noise=0:details=0:halo=0:blur=0:compression=0:prenoise=0:estimate=0:blend=0:grain=0:gsize=0:device=-2:vram=1:instances=0:download=0:kcolor=1", input.Model, width, height)}
	if input.Interpolation != "none" || input.Slowdown != "1x" {
		fpsMultiplier := map[string]float64{"2x": 2, "4x": 4}[input.Interpolation]
		if fpsMultiplier == 0 {
			fpsMultiplier = 1
		}
		fps := math.Max(1, probe.FPS) * fpsMultiplier
		slowmo := map[string]float64{"1x": 1, "2x": 2, "4x": 4}[input.Slowdown]
		filters = append(filters, fmt.Sprintf("tvai_fi=model=chr-2:device=-2:vram=1:instances=0:download=0:slowmo=%g:fps=%g", slowmo, fps))
	}
	qp := map[string]string{"high": "18", "balanced": "23", "compact": "28"}[input.Quality]
	encoder := "h264_nvenc"
	if width > 4096 || height > 4096 {
		encoder = "hevc_nvenc"
	}
	args := []string{installation.ffmpeg, "-hide_banner", "-nostdin", "-y"}
	if decoder := topazDecoderForInput(inputPath); decoder != "" {
		// Topaz's bundled FFmpeg does not include the generic H.264 decoder. Without
		// an explicit choice it picks Intel QSV, which cannot decode H3's NVIDIA MP4
		// output on this machine. Select NVIDIA hardware decoding only when the
		// container identifies its codec; unknown formats keep Topaz's own default.
		args = append(args, "-c:v", decoder)
	}
	args = append(args, "-i", inputPath, "-map", "0:v:0", "-map", "0:a?", "-vf", strings.Join(filters, ","), "-c:v", encoder, "-pix_fmt", "yuv420p", "-preset", "p7", "-tune", "hq", "-rc", "constqp", "-qp", qp, "-b:v", "0")
	if encoder == "h264_nvenc" {
		args = append(args, "-profile:v", "high", "-spatial_aq", "1", "-aq-strength", "15")
	} else {
		args = append(args, "-profile:v", "main", "-tag:v", "hvc1")
	}
	return append(args, "-c:a", "aac", "-b:a", "320k", "-map_metadata", "0", "-movflags", "frag_keyframe+empty_moov+delay_moov+use_metadata_tags+write_colr", "-progress", "pipe:1", "-nostats", outputPath)
}

func topazInputPath(id string) (string, error) {
	if !topazVideoIDPattern.MatchString(strings.ToLower(id)) {
		return "", errors.New("Topaz 输入视频标识无效")
	}
	for _, extension := range []string{".mp4", ".mov", ".mkv", ".webm"} {
		path := filepath.Join(topazVideoInputDir(), strings.ToLower(id)+extension)
		if isRegularFile(path) {
			return path, nil
		}
	}
	return "", errors.New("Topaz 输入视频不存在，请重新发起处理")
}

func topazDecoderForInput(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()

	buffer := make([]byte, 1<<20)
	read, _ := io.ReadFull(file, buffer)
	content := buffer[:read]
	switch {
	case bytes.Contains(content, []byte("avc1")), bytes.Contains(content, []byte("avc3")), bytes.Contains(content, []byte("V_MPEG4/ISO/AVC")):
		return "h264_cuvid"
	case bytes.Contains(content, []byte("hvc1")), bytes.Contains(content, []byte("hev1")), bytes.Contains(content, []byte("V_MPEGH/ISO/HEVC")):
		return "hevc_cuvid"
	case bytes.Contains(content, []byte("av01")), bytes.Contains(content, []byte("V_AV1")):
		return "av1_cuvid"
	default:
		return ""
	}
}

func topazVideoInputDir() string  { return filepath.Join(topazVideoRuntimeDir(), "input") }
func topazVideoOutputDir() string { return filepath.Join(topazVideoRuntimeDir(), "output") }

func topazVideoRuntimeDir() string {
	if workingDir, err := os.Getwd(); err == nil && strings.TrimSpace(workingDir) != "" {
		return filepath.Join(workingDir, ".runtime", "topaz-video")
	}
	return filepath.Join(".runtime", "topaz-video")
}

func isTopazInputExtension(extension string) bool {
	return extension == ".mp4" || extension == ".mov" || extension == ".mkv" || extension == ".webm"
}

func topazMimeType(extension string) string {
	if extension == ".mov" {
		return "video/quicktime"
	}
	if extension == ".webm" {
		return "video/webm"
	}
	return "video/mp4"
}

func evenDimension(value float64) int { return int(math.Max(16, math.Floor(value/2)*2)) }

func humanizeTopazError(lines []string) string {
	text := strings.Join(lines, "\n")
	if regexp.MustCompile(`(?i)no capable devices found|error while opening encoder`).MatchString(text) {
		return "Topaz 无法启动 NVIDIA 编码器，请确认显卡驱动正常后重试"
	}
	if regexp.MustCompile(`(?i)model.*not found|download.*failed`).MatchString(text) {
		return "Topaz 所需模型权重未就绪；请先在 Topaz Video 客户端下载该模型后重试"
	}
	if regexp.MustCompile(`(?i)license|activation|auth`).MatchString(text) {
		return "Topaz Video 授权不可用，请先在 Topaz Video 客户端完成登录与授权"
	}
	if len(strings.TrimSpace(text)) == 0 {
		return "Topaz FFmpeg 处理失败"
	}
	if len(text) > 1200 {
		text = text[len(text)-1200:]
	}
	return text
}

func isRegularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func uniquePaths(values []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(filepath.Clean(value))
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, value)
	}
	return result
}
