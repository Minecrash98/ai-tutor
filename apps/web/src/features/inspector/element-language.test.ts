import { describe, expect, it } from "vitest";

import {
  studentElementBreadcrumb,
  studentElementBreadcrumbItems,
  studentElementLabel,
  studentElementLabelIsInferred,
  studentStyleValue,
} from "./element-language";

describe("student element language", () => {
  it("turns implementation tags into student-facing names", () => {
    const result = {
      tagName: "DIV",
      domPath: "main#app > section.lesson > div.notice",
      attributes: { class: "notice" },
    };
    expect(studentElementLabel(result)).toBe("提示卡片");
    expect(studentElementBreadcrumb(result)).toEqual([
      "主要内容",
      "课程卡片",
      "提示卡片",
    ]);
  });

  it("uses an authored accessible name without exposing raw selectors", () => {
    const result = {
      tagName: "MAIN",
      domPath: "body > main#card",
      attributes: { "aria-label": "商品预览" },
    };
    expect(studentElementLabel(result)).toBe("商品预览");
    expect(studentElementBreadcrumb(result)).toEqual(["页面内容", "商品预览"]);
  });

  it("explains common CSS values in plain language", () => {
    expect(studentStyleValue("position", "static")).toBe("跟随页面自然排列");
    expect(studentStyleValue("box-sizing", "content-box")).toBe(
      "宽度只算内容，内侧空隙另加",
    );
    expect(studentStyleValue("width", "120px")).toBe("120px");
  });

  it("adds an ordinal to repeated semantic cards and marks inference", () => {
    const result = {
      tagName: "ARTICLE",
      domPath: "main > article.course-card:nth-of-type(1)",
      attributes: { class: "course-card" },
    };
    expect(studentElementLabel(result)).toBe("第一张课程卡片");
    expect(studentElementLabelIsInferred(result)).toBe(true);
    expect(studentElementBreadcrumbItems(result)[0]).toMatchObject({
      label: "主要内容",
      domPath: "main",
      current: false,
    });
  });

  it("does not call a Chinese authored accessible name inferred", () => {
    expect(
      studentElementLabelIsInferred({
        tagName: "MAIN",
        domPath: "main#work",
        attributes: { "aria-label": "我的作品" },
      }),
    ).toBe(false);
  });
});
