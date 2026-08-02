"use client";

import type { LearningLessonKind } from "@ai-tutor/contracts";
import { useState } from "react";

import type { LearningProofLocalSessionReference } from "./learning-proof-local";

interface LearningProofHistoryProps {
  readonly sessions: readonly LearningProofLocalSessionReference[];
  readonly activeSessionId: string | null;
  readonly onOpen: (sessionId: string) => Promise<boolean>;
  readonly onDelete: (sessionId: string) => Promise<boolean>;
}

const LESSON_LABEL: Readonly<Record<LearningLessonKind, string>> = {
  "box-model-v1": "盒模型：卡片为什么会变大",
  "flex-v1": "Flex：两条轴怎么配合",
  "positioning-v1": "定位：元素为什么离开队伍",
};

function shortTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function LearningProofHistory({
  sessions,
  activeSessionId,
  onOpen,
  onDelete,
}: LearningProofHistoryProps) {
  const [opening, setOpening] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  if (sessions.length === 0) return null;
  return (
    <details
      className="learning-history"
      role="region"
      aria-label="设备上的学习记录"
    >
      <summary>我的学习记录（{sessions.length}）</summary>
      <p>每节课单独保存。打开旧记录不会覆盖其他课程。</p>
      <ul>
        {[...sessions].reverse().map((session) => {
          const active = session.sessionId === activeSessionId;
          return (
            <li key={session.sessionId} data-learning-history-active={active}>
              <div>
                <strong>{LESSON_LABEL[session.lessonKind]}</strong>
                <small>{shortTime(session.startedAt)}</small>
              </div>
              <div>
                <button
                  type="button"
                  className="is-secondary"
                  aria-current={active ? "true" : undefined}
                  disabled={active || opening !== null || deleting !== null}
                  onClick={() => {
                    setArmedDelete(null);
                    setOpening(session.sessionId);
                    void onOpen(session.sessionId).finally(() => setOpening(null));
                  }}
                >
                  {active
                    ? "正在查看"
                    : opening === session.sessionId
                      ? "正在打开…"
                      : "打开记录"}
                </button>
                <button
                  type="button"
                  className="is-secondary"
                  disabled={active || opening !== null || deleting !== null}
                  onBlur={() => setArmedDelete(null)}
                  onClick={() => {
                    if (armedDelete !== session.sessionId) {
                      setArmedDelete(session.sessionId);
                      return;
                    }
                    setDeleting(session.sessionId);
                    void onDelete(session.sessionId).finally(() => {
                      setDeleting(null);
                      setArmedDelete(null);
                    });
                  }}
                >
                  {deleting === session.sessionId
                    ? "正在删除…"
                    : armedDelete === session.sessionId
                      ? "确认删除"
                      : "删除记录"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
