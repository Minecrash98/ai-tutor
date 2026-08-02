import { foundationStatus } from "@/lib/foundation-status";

const foundations = [
  {
    label: "TypeScript 单仓库",
    detail: "Web、协议、运行时和教学领域模型保持清晰边界。",
  },
  {
    label: "隔离运行时接口",
    detail: "静态 HTML/CSS 先行，未来运行时通过统一适配器接入。",
  },
  {
    label: "可验证基础",
    detail: "类型检查、单元测试、浏览器测试和构建从第一阶段建立。",
  },
];

export default function FoundationPage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="AI Tutor 首页">
          <span className="brand-mark">A</span>
          <span>
            <strong>AI Tutor</strong>
            <small>CSS Visual Lab</small>
          </span>
        </a>
        <span className="phase-badge">{foundationStatus.phaseLabel}</span>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">VOICE FIRST · VISUAL BY DESIGN</p>
          <h1>CSS 变化，应该看得见。</h1>
          <p className="hero-summary">
            上传页面或直接提问，把抽象样式拆成能够拖动、对比和调节的独立教学实验。
          </p>
          <div className="phase-note" role="status">
            <span className="status-dot" aria-hidden="true" />
            <span>
              当前仅完成项目基础；画布交互将在获得 P2 授权后实施。
            </span>
          </div>
        </div>

        <div className="canvas-preview" aria-label="教学画布预览占位">
          <div className="canvas-toolbar">
            <span />
            <span />
            <span />
            <b>P2 Canvas</b>
          </div>
          <div className="canvas-grid">
            <article className="preview-card preview-card-code">
              <span>HTML + CSS</span>
              <code>padding: 24px;</code>
            </article>
            <div className="preview-link" aria-hidden="true" />
            <article className="preview-card preview-card-result">
              <span>Visual result</span>
              <div className="box-model-demo">
                <div>content</div>
              </div>
            </article>
            <div className="canvas-placeholder">
              无限教学画布将在 P2 接入
            </div>
          </div>
        </div>
      </section>

      <section className="foundation-section" aria-labelledby="foundation-title">
        <div>
          <p className="eyebrow">FOUNDATION</p>
          <h2 id="foundation-title">先把边界搭稳。</h2>
        </div>
        <div className="foundation-grid">
          {foundations.map((item, index) => (
            <article className="foundation-card" key={item.label}>
              <span>0{index + 1}</span>
              <h3>{item.label}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
