"use client";

import {
  submitTransferAssessmentResponseSchema,
  transferAssessmentListResponseSchema,
  type TransferAssessmentItem,
  type TransferAssessmentListResponse,
} from "@ai-tutor/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

function responseMessage(value: unknown, fallback: string): string {
  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof value.message === "string"
  ) {
    return value.message;
  }
  return fallback;
}

function shortDate(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function safePreviewDeclaration(answer: string): string {
  const match = answer
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim()
    .match(/^([a-z-]+)\s*:\s*([^;{}<>]+?)\s*;?$/i);
  return match?.[1] && match[2]
    ? `${match[1]}: ${match[2]};`
    : "";
}

function previewDocument(item: TransferAssessmentItem, answer: string): string {
  if (!item.html || !item.baseCss || !item.targetSelector) return "";
  const declaration = safePreviewDeclaration(answer);
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'\">",
    `<style>${item.baseCss}${
      declaration
        ? `\n${item.targetSelector}{${declaration}}`
        : ""
    }</style></head><body>`,
    item.html,
    "</body></html>",
  ].join("");
}

export function TransferAssessmentPanel({
  sessionId,
  lessonComplete,
  onlineReady,
  onHiddenOutcome,
}: {
  readonly sessionId: string | null;
  readonly lessonComplete: boolean;
  readonly onlineReady: boolean;
  readonly onHiddenOutcome: (outcome: "passed" | "failed" | null) => void;
}) {
  const [assessment, setAssessment] =
    useState<TransferAssessmentListResponse | null>(null);
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({});
  const [submittedAnswers, setSubmittedAnswers] = useState<
    Readonly<Record<string, string>>
  >({});
  const [feedback, setFeedback] = useState<
    Readonly<Record<string, { message: string; passed: boolean }>>
  >({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId || !lessonComplete || !onlineReady) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/learning/sessions/${sessionId}/transfers`,
        { cache: "no-store" },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(responseMessage(payload, "新的挑战暂时无法读取。"));
      }
      setAssessment(transferAssessmentListResponseSchema.parse(payload));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "新的挑战暂时无法读取。",
      );
    } finally {
      setLoading(false);
    }
  }, [lessonComplete, onlineReady, sessionId]);

  useEffect(() => {
    setAssessment(null);
    setAnswers({});
    setSubmittedAnswers({});
    setFeedback({});
    setError(null);
    if (lessonComplete && onlineReady) void load();
  }, [lessonComplete, load, onlineReady, sessionId]);

  const orderedItems = useMemo(
    () =>
      assessment
        ? [...assessment.items].sort((left, right) =>
            left.kind === right.kind
              ? 0
              : left.kind === "immediate-hidden"
                ? -1
                : 1,
          )
        : [],
    [assessment],
  );

  useEffect(() => {
    const hidden = assessment?.items.find(
      (item) => item.kind === "immediate-hidden",
    );
    if (!hidden) {
      onHiddenOutcome(null);
      return;
    }
    if (hidden.status === "passed-on-time" || hidden.status === "passed-late") {
      onHiddenOutcome("passed");
      return;
    }
    onHiddenOutcome(hidden.attemptCount > 0 ? "failed" : null);
  }, [assessment, onHiddenOutcome]);

  if (!sessionId || !lessonComplete) return null;

  const submit = async (item: TransferAssessmentItem) => {
    const answer = answers[item.itemId]?.trim() ?? "";
    if (!answer) {
      setFeedback((current) => ({
        ...current,
        [item.itemId]: { passed: false, message: "先亲手补一条 CSS 声明。" },
      }));
      return;
    }
    setSubmitting(item.itemId);
    setError(null);
    try {
      const response = await fetch(
        `/api/learning/sessions/${sessionId}/transfers`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: item.itemId, answer }),
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(responseMessage(payload, "这次提交没有保存。"));
      }
      const result = submitTransferAssessmentResponseSchema.parse(payload);
      setSubmittedAnswers((current) => ({
        ...current,
        [item.itemId]: answer,
      }));
      setFeedback((current) => ({
        ...current,
        [item.itemId]: {
          passed: result.passed,
          message: result.feedback,
        },
      }));
      await load();
    } catch (submitError) {
      setFeedback((current) => ({
        ...current,
        [item.itemId]: {
          passed: false,
          message:
            submitError instanceof Error
              ? submitError.message
              : "这次提交没有保存。",
        },
      }));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <section
      className="transfer-assessment"
      aria-label="陌生迁移与延迟保持挑战"
    >
      <header>
        <span>课后挑战</span>
        <strong>换个页面，还能自己做到吗？</strong>
        <p>
          题目在小课完成后才出现。一次课内通过不等于长期掌握，隔天结果会单独记录。
        </p>
      </header>
      {!onlineReady ? <p>正在保存这节课的证据，保存后会揭示新页面…</p> : null}
      {loading && !assessment ? <p>正在准备新页面…</p> : null}
      {error ? (
        <div className="transfer-assessment__error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : null}
      {assessment ? (
        <>
          <ol>
            {orderedItems.map((item) => {
              const locked = item.status === "locked";
              const passed =
                item.status === "passed-on-time" ||
                item.status === "passed-late";
              const answer = answers[item.itemId] ?? "";
              const submittedAnswer = submittedAnswers[item.itemId] ?? "";
              const result = feedback[item.itemId];
              return (
                <li
                  key={item.itemId}
                  data-transfer-kind={item.kind}
                  data-transfer-status={item.status}
                >
                  <div className="transfer-assessment__title">
                    <div>
                      <span>
                        {item.kind === "immediate-hidden"
                          ? "现在 · 陌生页面"
                          : "隔天 · 保持挑战"}
                      </span>
                      <strong>
                        {locked
                          ? `${shortDate(item.dueAt)} 后再来`
                          : passed
                            ? item.status === "passed-late"
                              ? "补做通过（已超出时间窗）"
                              : "已经通过"
                            : "请独立完成"}
                      </strong>
                    </div>
                    <small>尝试 {item.attemptCount} 次</small>
                  </div>
                  {locked ? (
                    <p>
                      题目内容暂不显示。到期后独立完成，才能留下延迟保持证据。
                    </p>
                  ) : (
                    <>
                      <p>{item.prompt}</p>
                      <iframe
                        title={
                          item.kind === "immediate-hidden"
                            ? "陌生迁移页面预览"
                            : "延迟保持页面预览"
                        }
                        sandbox=""
                        srcDoc={previewDocument(item, submittedAnswer)}
                      />
                      <label>
                        <span>只补一条 CSS 声明</span>
                        <input
                          value={answer}
                          placeholder="属性: 值;"
                          disabled={passed || submitting === item.itemId}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setAnswers((current) => ({
                              ...current,
                              [item.itemId]: value,
                            }));
                          }}
                        />
                      </label>
                      <small>
                        预览只在点击“运行并提交”后更新，每次尝试都会被计数。
                      </small>
                      <button
                        type="button"
                        disabled={passed || submitting !== null}
                        onClick={() => void submit(item)}
                      >
                        {passed
                          ? "已留下证据"
                          : submitting === item.itemId
                            ? "正在检查…"
                            : "运行并提交"}
                      </button>
                      {result ? (
                        <p
                          className="transfer-assessment__feedback"
                          data-passed={result.passed}
                          role="status"
                        >
                          {result.message}
                        </p>
                      ) : null}
                    </>
                  )}
                  {item.closesAt && !locked ? (
                    <small className="transfer-assessment__window">
                      建议在 {shortDate(item.closesAt)} 前独立完成
                    </small>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <p className="transfer-assessment__boundary">
            {assessment.claimBoundary}
          </p>
        </>
      ) : null}
    </section>
  );
}
