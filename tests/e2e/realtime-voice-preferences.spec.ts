import { expect, test, type Page } from "@playwright/test";

test.use({ launchOptions: { args: ["--mute-audio"] } });

async function installDeviceList(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __microphoneCalls?: number;
      __lastAudioConstraints?: MediaTrackConstraints | boolean;
    };
    testWindow.__microphoneCalls = 0;
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: async () => [
        {
          deviceId: "synthetic-classroom-mic",
          groupId: "synthetic-group",
          kind: "audioinput",
          label: "课堂测试麦克风",
          toJSON: () => ({}),
        },
      ],
    });
  });
}

async function routeVoiceCapability(page: Page): Promise<void> {
  await page.route("**/api/realtime/capabilities", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ready: true,
        checkedAt: new Date().toISOString(),
        textAvailable: true,
        voiceAvailable: true,
      }),
    }),
  );
}

test("persists device, volume, speed, and caption choices without opening a microphone", async ({
  page,
}) => {
  await installDeviceList(page);
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __microphoneCalls?: number;
      __lastAudioConstraints?: MediaTrackConstraints | boolean;
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        testWindow.__microphoneCalls = (testWindow.__microphoneCalls ?? 0) + 1;
        testWindow.__lastAudioConstraints = constraints.audio;
        throw new DOMException("Synthetic permission denial", "NotAllowedError");
      },
    });
  });
  await routeVoiceCapability(page);

  let sessionPosts = 0;
  await page.route("**/api/realtime/session", async (route) => {
    if (route.request().method() === "POST") sessionPosts += 1;
    await route.fulfill({ status: 500, body: "{}" });
  });

  await page.goto("/");
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await expect(
    tutor.getByRole("radio", { name: /按住说话（推荐）/ }),
  ).not.toBeChecked();
  await expect(
    tutor.getByRole("radio", { name: /持续聆听/ }),
  ).not.toBeChecked();
  await expect(
    tutor.getByRole("button", { name: "开始语音讲解" }),
  ).toBeDisabled();
  await tutor.getByText("语音设置", { exact: true }).click();
  await tutor.getByLabel("选择麦克风").selectOption(
    "synthetic-classroom-mic",
  );
  await tutor.getByLabel("讲解音量").fill("45");
  await tutor.getByLabel("讲解语速").selectOption("1.2");
  await tutor.getByRole("radio", { name: /持续聆听/ }).check();
  const muteOutput = tutor.getByRole("checkbox", {
    name: /关闭讲解声音/,
  });
  const captions = tutor.getByRole("checkbox", { name: /显示同步字幕/ });
  await muteOutput.check();
  await expect(captions).toBeChecked();
  await expect(captions).toBeDisabled();
  await muteOutput.uncheck();
  await captions.uncheck();

  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("ai-tutor-voice-preferences-v1") ?? "null",
        ),
      ),
    )
    .toMatchObject({
      inputMode: "continuous",
      deviceId: "synthetic-classroom-mic",
      outputVolume: 0.45,
      playbackRate: 1.2,
      captionsEnabled: false,
    });
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __microphoneCalls?: number })
          .__microphoneCalls,
    ),
  ).toBe(0);

  await page.reload();
  await expect(
    tutor.getByRole("radio", { name: /持续聆听/ }),
  ).toBeChecked();
  await tutor.getByText("语音设置", { exact: true }).click();
  await expect(tutor.getByLabel("选择麦克风")).toHaveValue(
    "synthetic-classroom-mic",
  );
  await expect(tutor.getByLabel("讲解音量")).toHaveValue("45");
  await expect(tutor.getByLabel("讲解语速")).toHaveValue("1.2");
  await expect(captions).not.toBeChecked();

  await tutor.getByRole("button", { name: "开始语音讲解" }).click();
  await expect(tutor.locator("[data-realtime-status]")).toHaveAttribute(
    "data-realtime-status",
    "error",
  );
  const requestEvidence = await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __microphoneCalls?: number;
      __lastAudioConstraints?: MediaTrackConstraints;
    };
    return {
      calls: testWindow.__microphoneCalls,
      deviceId: testWindow.__lastAudioConstraints?.deviceId,
    };
  });
  expect(requestEvidence).toEqual({
    calls: 1,
    deviceId: { exact: "synthetic-classroom-mic" },
  });
  expect(sessionPosts).toBe(0);

  await tutor.getByRole("button", { name: "恢复默认并忘记设备" }).click();
  await expect(
    tutor.getByRole("button", { name: "开始语音讲解" }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("ai-tutor-voice-preferences-v1") ?? "null",
        ),
      ),
    )
    .toMatchObject({ inputMode: null, deviceId: null });
});

test("press-to-talk keeps a synthetic track closed until keyboard or touch press", async ({
  page,
}, testInfo) => {
  await installDeviceList(page);
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __microphoneCalls?: number;
      __syntheticAudioContext?: AudioContext;
      __syntheticMicrophone?: MediaStream;
      __remotePeers?: RTCPeerConnection[];
      __audioPreferenceWrites?: {
        volumes: number[];
        playbackRates: number[];
      };
    };
    testWindow.__audioPreferenceWrites = {
      volumes: [],
      playbackRates: [],
    };
    const volumeDescriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "volume",
    );
    const playbackRateDescriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "playbackRate",
    );
    if (volumeDescriptor?.get && volumeDescriptor.set) {
      Object.defineProperty(HTMLMediaElement.prototype, "volume", {
        configurable: volumeDescriptor.configurable,
        enumerable: volumeDescriptor.enumerable,
        get: volumeDescriptor.get,
        set(value: number) {
          testWindow.__audioPreferenceWrites?.volumes.push(value);
          volumeDescriptor.set?.call(this, value);
        },
      });
    }
    if (playbackRateDescriptor?.get && playbackRateDescriptor.set) {
      Object.defineProperty(HTMLMediaElement.prototype, "playbackRate", {
        configurable: playbackRateDescriptor.configurable,
        enumerable: playbackRateDescriptor.enumerable,
        get: playbackRateDescriptor.get,
        set(value: number) {
          testWindow.__audioPreferenceWrites?.playbackRates.push(value);
          playbackRateDescriptor.set?.call(this, value);
        },
      });
    }
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        testWindow.__microphoneCalls = (testWindow.__microphoneCalls ?? 0) + 1;
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        testWindow.__syntheticAudioContext = context;
        testWindow.__syntheticMicrophone = destination.stream;
        return destination.stream;
      },
    });
    testWindow.__remotePeers = [];
  });
  await routeVoiceCapability(page);
  await page.route("**/api/realtime/session/*/events", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        "id: 1",
        `data: ${JSON.stringify({
          type: "status",
          state: "connected",
          at: new Date().toISOString(),
        })}`,
        "",
        "id: 2",
        `data: ${JSON.stringify({
          type: "transcript",
          role: "assistant",
          text: "静音时仍然能看到这条字幕。",
          final: true,
          at: new Date().toISOString(),
        })}`,
        "",
        "",
      ].join("\n"),
    }),
  );
  await page.route("**/api/realtime/session/*/diagnostics", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{\"ok\":true}",
    }),
  );
  await page.route(/\/api\/realtime\/session\/[^/]+$/, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{\"ok\":true}",
    });
  });
  await page.route("**/api/realtime/session", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const request = route.request().postDataJSON() as {
      clientSessionId: string;
      sdp: string;
    };
    const answer = await page.evaluate(async (offerSdp) => {
      const testWindow = window as typeof window & {
        __remotePeers?: RTCPeerConnection[];
      };
      const peer = new RTCPeerConnection();
      testWindow.__remotePeers?.push(peer);
      peer.ondatachannel = (event) => {
        event.channel.onmessage = () => undefined;
      };
      await peer.setRemoteDescription({ type: "offer", sdp: offerSdp });
      await peer.setLocalDescription(await peer.createAnswer());
      if (peer.iceGatheringState !== "complete") {
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, 3_000);
          peer.addEventListener("icegatheringstatechange", () => {
            if (peer.iceGatheringState !== "complete") return;
            window.clearTimeout(timer);
            resolve();
          });
        });
      }
      return peer.localDescription?.sdp ?? "";
    }, request.sdp);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: request.clientSessionId,
        mode: "voice",
        sdp: answer,
        learningRecordEnabled: false,
        model: "local-synthetic-loopback",
        protocolVersion: "v3",
      }),
    });
  });

  await page.goto("/");
  const lesson = page.getByRole("region", { name: "一分钟盒模型课" });
  await lesson.getByRole("button", { name: "开始一分钟盒模型课" }).click();
  await expect(lesson.locator("[data-lesson-phase]")).toHaveAttribute(
    "data-lesson-phase",
    "predict",
  );
  const tutor = page.getByRole("region", { name: "AI 学习搭档" });
  await expect(
    tutor.getByRole("button", { name: "开始语音讲解" }),
  ).toBeDisabled();
  await tutor.getByRole("radio", { name: /按住说话（推荐）/ }).check();
  await tutor.getByText("语音设置", { exact: true }).click();
  await tutor.getByLabel("讲解音量").fill("45");
  await tutor.getByLabel("讲解语速").selectOption("1.2");
  await tutor.getByRole("checkbox", { name: /关闭讲解声音/ }).check();
  await tutor.getByRole("button", { name: "开始语音讲解" }).click();
  const pushToTalk = tutor.locator("button.is-push-to-talk");
  await expect(pushToTalk).toBeVisible({ timeout: 15_000 });
  await expect(tutor).toContainText("静音时仍然能看到这条字幕。");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const indexRaw = localStorage.getItem(
          "ai-tutor-learning-proof-index-v2",
        );
        if (!indexRaw) return null;
        const sessionId = (JSON.parse(indexRaw) as { activeSessionId: string })
          .activeSessionId;
        const raw = localStorage.getItem(
          `ai-tutor-learning-proof-session-v2:${sessionId}`,
        );
        if (!raw) return null;
        const events = (JSON.parse(raw) as {
          payload: {
            events: Array<{
              type: string;
              mode?: string;
              role?: string;
              status?: string;
              contentStored?: boolean;
              text?: string | null;
            }>;
          };
        }).payload.events;
        return {
          connected: events.some(
            (event) =>
              event.type === "audit-tutor-session" &&
              event.mode === "voice" &&
              event.status === "connected",
          ),
          privateCaption: events.some(
            (event) =>
              event.type === "audit-tutor-message" &&
              event.mode === "voice" &&
              event.role === "assistant" &&
              event.contentStored === false &&
              event.text === null,
          ),
        };
      }),
    )
    .toEqual({ connected: true, privateCaption: true });
  await expect(pushToTalk).toHaveAttribute("aria-pressed", "false");
  const audioWrites = await page.evaluate(
    () =>
      (window as typeof window & {
        __audioPreferenceWrites?: {
          volumes: number[];
          playbackRates: number[];
        };
      }).__audioPreferenceWrites,
  );
  expect(audioWrites?.volumes).toContain(0);
  expect(audioWrites?.playbackRates).toContain(1.2);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __syntheticMicrophone?: MediaStream })
          .__syntheticMicrophone?.getAudioTracks()[0]?.enabled,
    ),
  ).toBe(false);

  if (testInfo.project.name === "mobile-touch") {
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    await pushToTalk.scrollIntoViewIfNeeded();
    const box = await pushToTalk.boundingBox();
    expect(box).not.toBeNull();
    const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await expect(pushToTalk).toHaveAttribute("aria-pressed", "true");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await pushToTalk.focus();
    await page.keyboard.down(" ");
    await expect(pushToTalk).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __syntheticMicrophone?: MediaStream })
            .__syntheticMicrophone?.getAudioTracks()[0]?.enabled,
      ),
    ).toBe(true);
    await page.keyboard.up(" ");
  }
  await expect(pushToTalk).toHaveAttribute("aria-pressed", "false");
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __syntheticMicrophone?: MediaStream })
          .__syntheticMicrophone?.getAudioTracks()[0]?.enabled,
    ),
  ).toBe(false);

  await tutor.getByRole("checkbox", { name: /关闭讲解声音/ }).uncheck();
  await tutor.getByRole("checkbox", { name: /显示同步字幕/ }).uncheck();
  await expect(tutor).toContainText("字幕已关闭");
  await expect(tutor.getByText("静音时仍然能看到这条字幕。")).toHaveCount(0);

  await tutor.getByRole("button", { name: "立即停止" }).click();
  await expect(tutor.locator("[data-realtime-status]")).toHaveAttribute(
    "data-realtime-status",
    "stopped",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const indexRaw = localStorage.getItem(
          "ai-tutor-learning-proof-index-v2",
        );
        if (!indexRaw) return false;
        const sessionId = (JSON.parse(indexRaw) as { activeSessionId: string })
          .activeSessionId;
        const raw = localStorage.getItem(
          `ai-tutor-learning-proof-session-v2:${sessionId}`,
        );
        if (!raw) return false;
        return (JSON.parse(raw) as {
          payload: {
            events: Array<{ type: string; mode?: string; status?: string }>;
          };
        }).payload.events.some(
          (event) =>
            event.type === "audit-tutor-session" &&
            event.mode === "voice" &&
            event.status === "stopped",
        );
      }),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __microphoneCalls?: number })
          .__microphoneCalls,
    ),
  ).toBe(1);
});
