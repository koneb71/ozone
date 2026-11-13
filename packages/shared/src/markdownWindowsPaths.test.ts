import { expect, it, vi } from "vite-plus/test";
import { unified } from "unified";
import remarkParse from "remark-parse";

import { remarkKeepWindowsPaths } from "./markdownWindowsPaths.ts";

it("limits drive-path checks to the word containing each escape", () => {
  const processor = unified().use(remarkParse).use(remarkKeepWindowsPaths);
  const identifiers = Array.from({ length: 200 }, (_, index) => `metric_name_${index}`);
  const markdown = `Supported metrics: ${identifiers.map((name) => name.replaceAll("_", "\\_")).join(", ")}.`;
  const pattern = /(?:^|\W)[A-Za-z]:(?:[\\/]\S*)?$/.source;
  const test = RegExp.prototype.test;
  let inspectedCharacters = 0;
  using _test = vi.spyOn(RegExp.prototype, "test").mockImplementation(function (
    this: RegExp,
    value: string,
  ) {
    if (this.source === pattern) inspectedCharacters += value.length;
    return test.call(this, value);
  });

  expect(processor.parse(markdown)).toMatchObject({
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", value: `Supported metrics: ${identifiers.join(", ")}.` }],
      },
    ],
  });
  expect(inspectedCharacters).toBeGreaterThan(0);
  expect(inspectedCharacters).toBeLessThan(markdown.length * 2);
});

it("preserves prose paths and ordinary escapes across whitespace boundaries", () => {
  const processor = unified().use(remarkParse).use(remarkKeepWindowsPaths);
  for (const whitespace of [" ", "\t", "\u00a0", "\u2003", "\u202f", "\ufeff"]) {
    const markdown = String.raw`Before${whitespace}C:\Users\me\_build${whitespace}\*literal\*`;
    expect(processor.parse(markdown)).toMatchObject({
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              value: String.raw`Before${whitespace}C:\Users\me\_build${whitespace}*literal*`,
            },
          ],
        },
      ],
    });
  }
});

it("finds each escape's word after earlier escapes in the text", () => {
  const processor = unified().use(remarkParse).use(remarkKeepWindowsPaths);
  const markdown = String.raw`one\_two C:\a\_b \*x\* three\_four&#x20;D:\c\_d \*y\* *em*E:\e\_f \*z\*`;
  expect(processor.parse(markdown)).toMatchObject({
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", value: String.raw`one_two C:\a\_b *x* three_four D:\c\_d *y* ` },
          { type: "emphasis" },
          { type: "text", value: String.raw`E:\e\_f *z*` },
        ],
      },
    ],
  });
});
