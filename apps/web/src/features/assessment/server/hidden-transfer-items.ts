import type {
  LearningLessonKind,
  TransferAssessmentKind,
} from "@ai-tutor/contracts";
import { createHash } from "node:crypto";

export interface HiddenTransferDefinition {
  readonly itemId: string;
  readonly courseId: LearningLessonKind;
  readonly kind: TransferAssessmentKind;
  readonly prompt: string;
  readonly html: string;
  readonly baseCss: string;
  readonly targetSelector: string;
  readonly evaluationRule:
    | "uniform-padding-px-v1"
    | "horizontal-gap-px-v1"
    | "keyword-v1";
  readonly expectedProperty: string;
  readonly expectedValue: string;
  readonly evaluatorId: string;
}

export const HIDDEN_TRANSFER_ITEMS: readonly HiddenTransferDefinition[] =
  Object.freeze([
    {
      itemId: "box-transfer-b-1",
      courseId: "box-model-v1",
      kind: "immediate-hidden",
      prompt:
        "这是一本相册，不是刚才的卡片。请只补一条声明，让照片说明文字四周都有 24px 的里面留白。",
      html:
        '<main class="album"><figure><div class="photo">夏日照片</div><figcaption class="caption">在新结构里用同一条盒模型规则。</figcaption></figure></main>',
      baseCss:
        "*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#edf5ff;font-family:Arial,sans-serif;color:#17223b}.album{width:360px}.album figure{margin:0;border:3px solid #17223b;border-radius:22px;overflow:hidden;background:white;box-shadow:10px 10px 0 #9fb4ff}.photo{display:grid;place-items:center;height:150px;background:#c9d6ff;font-size:26px;font-weight:800}.caption{padding:4px;border-top:3px solid #17223b;line-height:1.5}",
      targetSelector: ".caption",
      evaluationRule: "uniform-padding-px-v1",
      expectedProperty: "padding",
      expectedValue: "24px",
      evaluatorId: "box-hidden-transfer-v2",
    },
    {
      itemId: "box-transfer-b-2",
      courseId: "box-model-v1",
      kind: "delayed-retention",
      prompt:
        "一天后再看这张车票。请只补一条声明，让票面内容与边框之间四周都有 18px 的里面留白。",
      html:
        '<main class="ticket"><header>城市通票</header><section class="ticket-body"><strong>08:30</strong><span>中央站 → 海边站</span></section><footer>请保留此票</footer></main>',
      baseCss:
        "*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff4d6;font-family:Arial,sans-serif;color:#202018}.ticket{width:390px;border:3px solid #202018;border-radius:18px;background:white;overflow:hidden}.ticket header,.ticket footer{padding:10px 18px;background:#d7ff43;font-weight:800}.ticket-body{padding:2px;display:grid;gap:8px;border-block:2px dashed #202018}.ticket-body strong{font-size:34px}",
      targetSelector: ".ticket-body",
      evaluationRule: "uniform-padding-px-v1",
      expectedProperty: "padding",
      expectedValue: "18px",
      evaluatorId: "box-delayed-retention-v2",
    },
    {
      itemId: "flex-transfer-b-1",
      courseId: "flex-v1",
      kind: "immediate-hidden",
      prompt:
        "这是音乐播放器工具栏。请只补一条声明，让三个按钮之间保持 28px 的间距，不改变按钮本身大小。",
      html:
        '<nav class="player"><button>上一首</button><button>播放</button><button>下一首</button></nav>',
      baseCss:
        "*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f0ebff;font-family:Arial,sans-serif}.player{display:flex;gap:4px;padding:24px;border:3px solid #202018;border-radius:24px;background:white}.player button{padding:12px 16px;border:2px solid #202018;border-radius:12px;background:#d7ff43;font-weight:800}",
      targetSelector: ".player",
      evaluationRule: "horizontal-gap-px-v1",
      expectedProperty: "gap",
      expectedValue: "28px",
      evaluatorId: "flex-hidden-transfer-v2",
    },
    {
      itemId: "flex-transfer-b-2",
      courseId: "flex-v1",
      kind: "delayed-retention",
      prompt:
        "一天后再看这组不同高度的成员卡。请只补一条声明，让它们的底边在交叉轴上对齐。",
      html:
        '<section class="roster"><article>A<br>设计</article><article>B<br>前端<br>动画</article><article>C<br>测试</article></section>',
      baseCss:
        "*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eaf7ef;font-family:Arial,sans-serif}.roster{display:flex;align-items:flex-start;gap:18px;width:430px;min-height:210px;padding:24px;border:3px solid #173426;border-radius:24px;background:white}.roster article{padding:14px;border:2px solid #173426;border-radius:14px;background:#bcebc9;font-weight:800;line-height:1.6}",
      targetSelector: ".roster",
      evaluationRule: "keyword-v1",
      expectedProperty: "align-items",
      expectedValue: "flex-end",
      evaluatorId: "flex-delayed-retention-v2",
    },
    {
      itemId: "positioning-transfer-b-1",
      courseId: "positioning-v1",
      kind: "immediate-hidden",
      prompt:
        "这是商品缩略图。角标已有 top 和 right，请只补一条声明，让角标离开普通队伍并贴到缩略图右上角。",
      html:
        '<article class="product"><div class="thumb">图片</div><strong>帆布包</strong><span class="badge">新品</span></article>',
      baseCss:
        "*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff0ef;font-family:Arial,sans-serif}.product{position:relative;width:280px;padding:20px;border:3px solid #321d1d;border-radius:24px;background:white}.thumb{display:grid;place-items:center;height:150px;margin-bottom:14px;background:#ffc9c4;border-radius:14px}.badge{position:static;top:12px;right:12px;padding:7px 11px;border:2px solid #321d1d;border-radius:999px;background:#d7ff43;font-weight:800}",
      targetSelector: ".badge",
      evaluationRule: "keyword-v1",
      expectedProperty: "position",
      expectedValue: "absolute",
      evaluatorId: "positioning-hidden-transfer-v2",
    },
    {
      itemId: "positioning-transfer-b-2",
      courseId: "positioning-v1",
      kind: "delayed-retention",
      prompt:
        "一天后再看这个提示框。提示文字已经 absolute，请只补父容器的一条声明，让它以面板作为定位参照。",
      html:
        '<section class="panel"><button>查看说明</button><aside class="tip">提示文字</aside></section>',
      baseCss:
        "*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#edf4ff;font-family:Arial,sans-serif}.panel{position:static;width:360px;min-height:180px;padding:28px;border:3px dashed #27405e;border-radius:22px;background:white}.panel button{padding:12px 16px}.tip{position:absolute;right:18px;bottom:18px;padding:10px 14px;border:2px solid #27405e;border-radius:12px;background:#c9d6ff;font-weight:800}",
      targetSelector: ".panel",
      evaluationRule: "keyword-v1",
      expectedProperty: "position",
      expectedValue: "relative",
      evaluatorId: "positioning-delayed-retention-v2",
    },
  ]);

export function hiddenTransferHash(item: HiddenTransferDefinition): string {
  return createHash("sha256").update(JSON.stringify(item)).digest("hex");
}

export function hiddenTransfersForCourse(
  courseId: LearningLessonKind,
): readonly HiddenTransferDefinition[] {
  return HIDDEN_TRANSFER_ITEMS.filter((item) => item.courseId === courseId);
}

export function hiddenTransferById(
  itemId: string,
): HiddenTransferDefinition | null {
  return HIDDEN_TRANSFER_ITEMS.find((item) => item.itemId === itemId) ?? null;
}
