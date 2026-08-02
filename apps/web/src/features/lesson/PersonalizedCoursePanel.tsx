"use client";

import type { RuntimeProjectRecord } from "../canvas/p5-model";
import type { PersonalizedCoursePlan } from "./personalized-course";

interface PersonalizedCoursePanelProps {
  readonly blockId: string | null;
  readonly record: RuntimeProjectRecord | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly needsRefresh: boolean;
  readonly onGenerate: (blockId: string) => Promise<void>;
  readonly onAnswer: (
    blockId: string,
    planId: string,
    kind: "prediction" | "explanation",
    answer: string,
  ) => void;
  readonly onVerify: (blockId: string, planId: string) => Promise<void>;
  readonly onFocusExperiment: (blockId: string, plan: PersonalizedCoursePlan) => void;
  readonly onContinueCourse: (plan: PersonalizedCoursePlan) => Promise<void>;
}

const TOPIC_LABEL: Readonly<Record<PersonalizedCoursePlan["topic"], string>> = {
  "box-model": "盒模型",
  flex: "Flex 排列",
  positioning: "定位",
};

function observation(plan: PersonalizedCoursePlan): string {
  if (plan.topic === "box-model") {
    return `浏览器量到外框宽 ${plan.before.boundingWidth}px，四周里面留白是 ${plan.before.computedValue}。`;
  }
  if (plan.topic === "flex") {
    return `这个容器实际使用 Flex，里面有 ${plan.before.childCount} 个可见项目，当前间距是 ${plan.before.computedValue}。`;
  }
  return `这个元素当前位于 (${plan.before.boundingX}, ${plan.before.boundingY})，${plan.experiment.property} 是 ${plan.before.computedValue}。`;
}

function verifiedObservation(plan: PersonalizedCoursePlan): string | null {
  const after = plan.progress.verification;
  if (!after) return null;
  if (plan.topic === "box-model") {
    return `保存后浏览器重新量到：${plan.experiment.property} ${after.computedValue}，外框宽 ${plan.before.boundingWidth}px → ${after.boundingWidth}px。`;
  }
  if (plan.topic === "flex") {
    return `保存后浏览器重新读到项目间距 ${after.computedValue}；页面规则与这次保存一致。`;
  }
  return `保存后浏览器重新量到位置 (${after.boundingX}, ${after.boundingY})，${plan.experiment.property} 为 ${after.computedValue}。`;
}

export function PersonalizedCoursePanel({
  blockId,
  record,
  busy,
  error,
  needsRefresh,
  onGenerate,
  onAnswer,
  onVerify,
  onFocusExperiment,
  onContinueCourse,
}: PersonalizedCoursePanelProps) {
  const plan = record?.personalizedCourse ?? null;
  const verified = plan ? verifiedObservation(plan) : null;

  return (
    <section className="personalized-course" aria-label="用我的页面上课">
      <header>
        <span>我的页面小课</span>
        <h2>只根据页面里的真实规则出题</h2>
      </header>

      {!blockId || !record ? (
        <p>载入 HTML 和 CSS 后，这里会找一条能在浏览器里核对的规则。找不到足够证据时不会猜。</p>
      ) : !plan || needsRefresh ? (
        <div className="personalized-course__start">
          <p>
            {needsRefresh
              ? "页面已经有新版本。重新核对后再继续，旧结论不会套到新代码上。"
              : `已载入 ${record.snapshot.entryFile}，可以从源码和实际页面生成一个最小实验。`}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onGenerate(blockId)}
          >
            {busy ? "正在核对页面…" : needsRefresh ? "重新生成这节小课" : "用这个页面生成小课"}
          </button>
        </div>
      ) : (
        <div className="personalized-course__lesson" data-personalized-topic={plan.topic}>
          <div className="personalized-course__fact">
            <b>{TOPIC_LABEL[plan.topic]}</b>
            <strong>{plan.title}</strong>
            <code>
              {plan.source.filePath}:{plan.source.line} · {plan.source.selector}
            </code>
            <p>{observation(plan)}</p>
            <details>
              <summary>查看这道题依据的样式</summary>
              <code>
                {Object.entries(plan.source.declarations)
                  .map(([property, value]) => `${property}: ${value}`)
                  .join("; ")}
              </code>
            </details>
          </div>

          <fieldset>
            <legend>1. {plan.experiment.predictionQuestion}</legend>
            {plan.experiment.predictionChoices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                aria-pressed={plan.progress.predictionAnswer === choice.id}
                onClick={() =>
                  onAnswer(blockId, plan.id, "prediction", choice.id)
                }
              >
                {choice.label}
              </button>
            ))}
            {plan.progress.predictionAnswer ? (
              <small>判断已保留。先做实验，再用页面事实核对。</small>
            ) : null}
          </fieldset>

          {plan.progress.predictionAnswer ? (
            <div className="personalized-course__experiment">
              <strong>2. 亲手做一个最小实验</strong>
              <p>
                在画布旁的调节卡里，把 <code>{plan.experiment.property}</code> 从{" "}
                <b>{plan.before.computedValue}</b> 调到 <b>{plan.experiment.trialValue}</b>，松手保存。
              </p>
              <div>
                <button
                  type="button"
                  className="is-secondary"
                  onClick={() => onFocusExperiment(blockId, plan)}
                >
                  找到页面和调节卡
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onVerify(blockId, plan.id)}
                >
                  {busy ? "正在重新测量…" : "我已保存，核对变化"}
                </button>
              </div>
              {verified ? <p role="status">{verified}</p> : null}
            </div>
          ) : null}

          {plan.progress.verification ? (
            <fieldset>
              <legend>3. {plan.experiment.explanationQuestion}</legend>
              {plan.experiment.explanationChoices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  aria-pressed={plan.progress.explanationAnswer === choice.id}
                  onClick={() =>
                    onAnswer(blockId, plan.id, "explanation", choice.id)
                  }
                >
                  {choice.label}
                </button>
              ))}
              {plan.progress.explanationCorrect === false ? (
                <small role="alert">这个解释还没有和上面的源码与测量对上，可以再选一次。</small>
              ) : null}
            </fieldset>
          ) : null}

          {plan.progress.explanationCorrect ? (
            <div className="personalized-course__continue">
              <strong>自己的页面实验已完成</strong>
              <p>
                这只证明本次实验成立，不代表长期掌握。继续完整小课后，服务器才会发一题预先冻结、不会提前露出答案的新页面挑战。
              </p>
              <button type="button" onClick={() => void onContinueCourse(plan)}>
                继续完整小课与隐藏挑战
              </button>
            </div>
          ) : null}
        </div>
      )}

      {error ? <p className="personalized-course__error" role="alert">{error}</p> : null}
    </section>
  );
}
