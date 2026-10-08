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

func TestHumanizeTopazErrorDoesNotMisreadSuccessfulLicenseCheckout(t *testing.T) {
	lines := []string{
		"[AIE-RLM] License checkout status: 0",
		"[AIE-RLM] License expiration details: permanent 0",
		"[AIE-RLM] License checkout successful Owned - Cached License: 0",
		"License expires in 0 days.",
		"[Parsed_tvai_up_0] Failed to configure output pad on Parsed_tvai_up_0",
		"Error reinitializing filters!",
	}
	got := humanizeTopazError(lines)
	if strings.Contains(got, "授权不可用") || !strings.Contains(got, "Failed to configure output pad") {
		t.Fatalf("successful checkout must preserve the real filter failure, got %q", got)
	}
}

func TestBuildTopazCommandEnforcesRequestedOutputDimensions(t *testing.T) {
	for _, interpolation := range []string{"none", "2x"} {
		command := buildTopazCommand(
			topazInstallation{ffmpeg: "ffmpeg"}, "source.mp4", "output.mp4",
			TopazVideoTaskInput{Model: "alq-13", Quality: "high", Interpolation: interpolation, Slowdown: "1x"},
			topazProbe{Width: 864, Height: 480, FPS: 24}, 3888, 2160,
		)
		var filters string
		for i, arg := range command {
			if arg == "-vf" {
				filters = command[i+1]
				break
			}
		}
		if !strings.HasSuffix(filters, "scale=3888:2160:flags=lanczos,setsar=1") {
			t.Fatalf("%s: Topaz's discrete AI scale must be resized to the requested dimensions: %s", interpolation, filters)
		}
	}
}

func TestHumanizeTopazErrorRecognizesExplicitLicenseFailures(t *testing.T) {
	for _, line := range []string{
		"License checkout failed",
		"License checkout status: -1",
		"Invalid license",
		"License expired",
		"Authentication required",
		"Unauthorized",
	} {
		t.Run(line, func(t *testing.T) {
			if got := humanizeTopazError([]string{line}); !strings.Contains(got, "授权不可用") {
				t.Fatalf("explicit authorization failure must be identified, got %q", got)
			}
		})
	}
}
