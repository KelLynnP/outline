import { useEffect, useRef, useState } from "react";
import type { CaughtItem } from "@life-console/shared";
import { EditorState, StateEffect } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import {
  codeFolding,
  defaultHighlightStyle,
  foldEffect,
  foldedRanges,
  foldKeymap,
  foldService,
  indentUnit,
  syntaxHighlighting,
  unfoldEffect,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import {
  Decoration,
  EditorView,
  keymap,
  placeholder,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { api } from "../api.js";
import {
  NoteTaskDetails,
  type NoteTaskDisplay,
} from "./NoteTaskDetails.js";

type FoldRange = { from: number; to: number };
type TaskTrigger = { from: number; to: number; query: string };

const TASK_TOKEN = /\{\{task:(\d+)(?:\|show=([a-z,]*))?\}\}/g;
const refreshTaskObjects = StateEffect.define<void>();
const DISPLAY_KEYS = ["linear", "assignee", "due", "tags"] as const;

function taskDisplay(raw: string | undefined): NoteTaskDisplay {
  if (raw === undefined) {
    return { linear: true, assignee: true, due: true, tags: true };
  }
  const shown = new Set(raw.split(","));
  return {
    linear: shown.has("linear"),
    assignee: shown.has("assignee"),
    due: shown.has("due"),
    tags: shown.has("tags"),
  };
}

export function taskToken(id: number, display: NoteTaskDisplay): string {
  const shown = DISPLAY_KEYS.filter((key) => display[key]);
  return shown.length === DISPLAY_KEYS.length
    ? `{{task:${id}}}`
    : `{{task:${id}|show=${shown.join(",")}}}`;
}

export function findTaskTrigger(doc: string, cursor: number): TaskTrigger | null {
  const before = doc.slice(0, cursor);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);
  const match = /\[\]([^\n[\]{}]*)$/.exec(line);
  if (!match) return null;
  const from = lineStart + match.index;
  if (from > lineStart && !/\s/.test(doc[from - 1])) return null;
  return { from, to: cursor, query: match[1].trim() };
}

export function taskReferences(doc: string): number[] {
  return [...doc.matchAll(TASK_TOKEN)].map((match) => Number(match[1]));
}

export function matchingTasks(items: CaughtItem[], query: string): CaughtItem[] {
  const needle = query.toLowerCase();
  return items
    .filter((item) =>
      [
        item.text,
        item.linear_identifier,
        item.linear_team,
        item.assignee,
        ...item.tags,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    )
    .sort(
      (a, b) =>
        Number(a.status === "closed") - Number(b.status === "closed") ||
        a.text.localeCompare(b.text),
    )
    .slice(0, 8);
}

class TaskObjectWidget extends WidgetType {
  constructor(
    private readonly item: CaughtItem | undefined,
    private readonly id: number,
    private readonly from: number,
    private readonly display: NoteTaskDisplay,
    private readonly onOpen: (
      id: number,
      from: number,
      display: NoteTaskDisplay,
      dom: HTMLElement,
    ) => void,
    private readonly onToggle: (item: CaughtItem) => void,
  ) {
    super();
  }

  eq(other: TaskObjectWidget) {
    return (
      this.id === other.id &&
      this.from === other.from &&
      JSON.stringify(this.display) === JSON.stringify(other.display) &&
      JSON.stringify(this.item) === JSON.stringify(other.item)
    );
  }

  ignoreEvent() {
    return true;
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = `cm-task-object${this.item?.status === "closed" ? " done" : ""}`;
    wrapper.contentEditable = "false";

    if (!this.item) {
      wrapper.classList.add("missing");
      wrapper.textContent = "missing task";
      return wrapper;
    }

    const check = document.createElement("button");
    check.type = "button";
    check.className = "cm-task-check";
    check.title = this.item.status === "closed" ? "reopen task" : "complete task";
    check.setAttribute("aria-label", check.title);
    check.addEventListener("mousedown", (event) => event.preventDefault());
    check.addEventListener("click", (event) => {
      event.stopPropagation();
      this.onToggle(this.item!);
    });
    wrapper.append(check);

    const title = document.createElement("button");
    title.type = "button";
    title.className = "cm-task-title";
    title.textContent = this.item.text;
    title.title = "show task details";
    title.addEventListener("mousedown", (event) => event.preventDefault());
    title.addEventListener("click", () =>
      this.onOpen(this.id, this.from, this.display, wrapper),
    );
    wrapper.append(title);

    if (this.display.linear && this.item.source === "linear") {
      const linear = document.createElement("span");
      linear.className = "cm-task-meta linear";
      linear.textContent = `L${this.item.linear_identifier ? ` · ${this.item.linear_identifier}` : ""}`;
      wrapper.append(linear);
    }
    if (this.display.assignee && this.item.assignee) {
      const who = document.createElement("span");
      who.className = "cm-task-meta";
      who.textContent = `@${this.item.assignee}`;
      wrapper.append(who);
    }
    if (this.display.due && this.item.due_date) {
      const due = document.createElement("span");
      due.className = "cm-task-meta";
      due.textContent = new Date(`${this.item.due_date}T00:00:00`).toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric" },
      );
      wrapper.append(due);
    }
    if (this.display.tags) {
      for (const tag of this.item.tags) {
        const meta = document.createElement("span");
        meta.className = "cm-task-meta";
        meta.textContent = `#${tag}`;
        wrapper.append(meta);
      }
    }
    return wrapper;
  }
}

function taskObjectDecorations(
  view: EditorView,
  items: { current: CaughtItem[] },
  onOpen: {
    current: (
      id: number,
      from: number,
      display: NoteTaskDisplay,
      dom: HTMLElement,
    ) => void;
  },
  onToggle: { current: (item: CaughtItem) => void },
): DecorationSet {
  const ranges = [];
  const text = view.state.doc.toString();
  for (const match of text.matchAll(TASK_TOKEN)) {
    const from = match.index!;
    const id = Number(match[1]);
    ranges.push(
      Decoration.replace({
        widget: new TaskObjectWidget(
          items.current.find((item) => item.id === id),
          id,
          from,
          taskDisplay(match[2]),
          onOpen.current,
          onToggle.current,
        ),
      }).range(from, from + match[0].length),
    );
  }
  return Decoration.set(ranges, true);
}

function taskObjects(
  items: { current: CaughtItem[] },
  onOpen: {
    current: (
      id: number,
      from: number,
      display: NoteTaskDisplay,
      dom: HTMLElement,
    ) => void;
  },
  onToggle: { current: (item: CaughtItem) => void },
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      atomics: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = taskObjectDecorations(view, items, onOpen, onToggle);
        this.atomics = this.decorations;
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(refreshTaskObjects)),
          )
        ) {
          this.decorations = taskObjectDecorations(update.view, items, onOpen, onToggle);
          this.atomics = this.decorations;
        }
      }
    },
    {
      decorations: (value) => value.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(plugin)?.atomics ?? Decoration.none,
        ),
    },
  );
}

function listFoldRange(state: EditorState, lineStart: number): FoldRange | null {
  const line = state.doc.lineAt(lineStart);
  const match = /^(\s*)[-*+]\s+/.exec(line.text);
  if (!match) return null;

  const parentIndent = match[1].length;
  let end = line.to;
  let hasContent = false;

  for (let number = line.number + 1; number <= state.doc.lines; number++) {
    const next = state.doc.line(number);
    if (!next.text.trim()) {
      if (hasContent) end = next.to;
      continue;
    }

    const indent = /^\s*/.exec(next.text)?.[0].length ?? 0;
    if (indent <= parentIndent) break;
    hasContent = true;
    end = next.to;
  }

  return hasContent ? { from: line.to, to: end } : null;
}

const listFolding = foldService.of((state, lineStart) =>
  listFoldRange(state, lineStart),
);

/** All existing folds overlapping `range`. Edits can shift a fold out of
 *  exact alignment with the freshly computed range, so unfolding must match
 *  loosely or a drifted fold becomes permanently stuck. */
function foldsWithin(state: EditorState, range: FoldRange): FoldRange[] {
  const folds: FoldRange[] = [];
  foldedRanges(state).between(range.from, range.to, (from, to) => {
    folds.push({ from, to });
  });
  return folds;
}

// Every bullet renders as a dot. Dots with nested content get color and
// toggle folding on click; childless dots are inert (clicks fall through to
// the editor for cursor placement).
class BulletWidget extends WidgetType {
  constructor(
    private readonly lineFrom: number,
    private readonly folded: boolean,
    private readonly hasChildren: boolean,
  ) {
    super();
  }

  eq(other: BulletWidget) {
    return (
      this.lineFrom === other.lineFrom &&
      this.folded === other.folded &&
      this.hasChildren === other.hasChildren
    );
  }

  ignoreEvent() {
    return this.hasChildren; // childless dots let the editor handle clicks
  }

  toDOM(view: EditorView) {
    const dot = document.createElement("span");
    dot.className = `cm-note-bullet${this.hasChildren ? " has-children" : ""}${
      this.folded ? " folded" : ""
    }`;
    if (this.hasChildren) {
      dot.title = this.folded ? "show nested notes" : "hide nested notes";
      dot.setAttribute("role", "button");
      dot.setAttribute("aria-label", dot.title);
      dot.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const range = listFoldRange(view.state, this.lineFrom);
        if (!range) return;
        const folds = foldsWithin(view.state, range);
        view.dispatch({
          effects: folds.length
            ? folds.map((fold) => unfoldEffect.of(fold))
            : foldEffect.of(range),
        });
        view.focus();
      });
    }
    return dot;
  }
}

function bulletDecorations(view: EditorView): DecorationSet {
  const ranges = [];
  for (let number = 1; number <= view.state.doc.lines; number++) {
    const line = view.state.doc.line(number);
    const match = /^(\s*)([-*+])\s/.exec(line.text);
    if (!match) continue;
    const foldRange = listFoldRange(view.state, line.from);
    // Push nesting into `text-indent` (first-line only) so wrapped
    // continuation flows flush-left across the full pane width, while the
    // bullet stays visually indented on line 1.
    const indentCh = match[1].length;
    if (indentCh > 0) {
      ranges.push(
        Decoration.line({
          attributes: { style: `text-indent:${indentCh / 2}ch` },
        }).range(line.from),
      );
    }
    // Replace the source-level leading whitespace + dash with just the
    // bullet widget — otherwise those raw spaces would push the wrapped
    // line right along with the first line.
    ranges.push(
      Decoration.replace({
        widget: new BulletWidget(
          line.from,
          foldRange ? foldsWithin(view.state, foldRange).length > 0 : false,
          foldRange !== null,
        ),
      }).range(line.from, line.from + match[1].length + 1),
    );
  }
  return Decoration.set(ranges, true);
}

const bulletPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = bulletDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.transactions.some((t) => t.effects.length)) {
        this.decorations = bulletDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

function richTextDecorations(view: EditorView): {
  all: DecorationSet;
  hidden: DecorationSet;
} {
  const ranges = [];
  // Hidden tokens double as atomic ranges: the cursor steps over a whole tag
  // and backspace deletes it in one go, so a tag can never be half-deleted.
  const hidden = [];

  const addWrapped = (
    lineFrom: number,
    text: string,
    regex: RegExp,
    contentGroup: number,
    className: (match: RegExpExecArray) => string,
  ) => {
    for (const match of text.matchAll(regex)) {
      const wholeAt = match.index ?? 0;
      const content = match[contentGroup];
      const contentAt = match[0].indexOf(content);
      const contentFrom = lineFrom + wholeAt + contentAt;
      const contentTo = contentFrom + content.length;
      ranges.push(
        Decoration.mark({ class: className(match) }).range(
          contentFrom,
          contentTo,
        ),
      );
      hidden.push(
        Decoration.replace({ inclusive: true }).range(
          lineFrom + wholeAt,
          contentFrom,
        ),
        Decoration.replace({ inclusive: true }).range(
          contentTo,
          lineFrom + wholeAt + match[0].length,
        ),
      );
    }
  };

  for (let number = 1; number <= view.state.doc.lines; number++) {
    const line = view.state.doc.line(number);
    const heading = /^(#{1,3})\s/.exec(line.text);
    if (heading) {
      ranges.push(
        Decoration.line({
          class: `cm-note-heading cm-note-h${heading[1].length}`,
        }).range(line.from),
      );
      hidden.push(
        Decoration.replace({ inclusive: true }).range(
          line.from,
          line.from + heading[0].length,
        ),
      );
    }
    addWrapped(
      line.from,
      line.text,
      /<u>(.+?)<\/u>/g,
      1,
      () => "cm-note-underline",
    );
    addWrapped(
      line.from,
      line.text,
      /~~(.+?)~~/g,
      1,
      () => "cm-note-strike",
    );
    addWrapped(
      line.from,
      line.text,
      /<mark data-color="(yellow|green|blue|pink)">(.+?)<\/mark>/g,
      2,
      (match) => `cm-note-highlight ${match[1]}`,
    );
    addWrapped(
      line.from,
      line.text,
      /<span data-color="(red|green|blue|purple)">(.+?)<\/span>/g,
      2,
      (match) => `cm-note-text ${match[1]}`,
    );
  }
  const hiddenSet = Decoration.set(hidden, true);
  return {
    all: Decoration.set([...ranges, ...hidden], true),
    hidden: hiddenSet,
  };
}

const richTextPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomics: DecorationSet;

    constructor(view: EditorView) {
      const sets = richTextDecorations(view);
      this.decorations = sets.all;
      this.atomics = sets.hidden;
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        const sets = richTextDecorations(update.view);
        this.decorations = sets.all;
        this.atomics = sets.hidden;
      }
    }
  },
  {
    decorations: (value) => value.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.atomics ?? Decoration.none,
      ),
  },
);

function wrapSelection(view: EditorView, open: string, close: string) {
  const selection = view.state.selection.main;
  const word = selection.empty
    ? view.state.wordAt(selection.head)
    : selection;
  if (!word) {
    view.focus();
    return;
  }
  const selected = view.state.sliceDoc(word.from, word.to);
  const before = view.state.sliceDoc(
    Math.max(0, word.from - open.length),
    word.from,
  );
  const after = view.state.sliceDoc(
    word.to,
    Math.min(view.state.doc.length, word.to + close.length),
  );
  const prefix = view.state.sliceDoc(Math.max(0, word.from - 50), word.from);
  const previousColorOpen = open.startsWith("<mark ")
    ? /<mark data-color="(?:yellow|green|blue|pink)">$/.exec(prefix)?.[0]
    : open.startsWith("<span ")
      ? /<span data-color="(?:red|green|blue|purple)">$/.exec(prefix)?.[0]
      : undefined;

  if (previousColorOpen && after === close && previousColorOpen !== open) {
    const difference = open.length - previousColorOpen.length;
    view.dispatch({
      changes: {
        from: word.from - previousColorOpen.length,
        to: word.from,
        insert: open,
      },
      selection: {
        anchor: word.from + difference,
        head: word.to + difference,
      },
    });
    view.focus();
    return;
  }

  if (before === open && after === close) {
    view.dispatch({
      changes: [
        { from: word.from - open.length, to: word.from },
        { from: word.to, to: word.to + close.length },
      ],
      selection: {
        anchor: word.from - open.length,
        head: word.to - open.length,
      },
    });
  } else {
    view.dispatch({
      changes: {
        from: word.from,
        to: word.to,
        insert: `${open}${selected}${close}`,
      },
      selection: {
        anchor: word.from + open.length,
        head: word.to + open.length,
      },
    });
  }
  view.focus();
}

export function cleanFormatting(value: string): string {
  let cleaned = value;
  let previous = "";
  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned
      .replace(/<u>([\s\S]*?)<\/u>/g, (_, content: string) =>
        content
          .split("\n")
          .map((line) => (line ? `<u>${line}</u>` : ""))
          .join("\n"),
      )
      .replace(
        /<mark data-color="(yellow|green|blue|pink)">([\s\S]*?)<\/mark>/g,
        (_, color: string, content: string) =>
          content
            .split("\n")
            .map((line) =>
              line ? `<mark data-color="${color}">${line}</mark>` : "",
            )
            .join("\n"),
      )
      .replace(
        /<span data-color="(red|green|blue|purple)">([\s\S]*?)<\/span>/g,
        (_, color: string, content: string) =>
          content
            .split("\n")
            .map((line) =>
              line ? `<span data-color="${color}">${line}</span>` : "",
            )
            .join("\n"),
      )
      .replace(/~~([\s\S]*?)~~/g, (_, content: string) =>
        content
          .split("\n")
          .map((line) => (line ? `~~${line}~~` : ""))
          .join("\n"),
      )
      .replace(/<mark data-color="(?:yellow|green|blue|pink)">\s*<\/mark>/g, "")
      .replace(/<span data-color="(?:red|green|blue|purple)">\s*<\/span>/g, "")
      .replace(/<u>\s*<\/u>/g, "")
      .replace(/~~~~/g, "");
  }
  // Strip any tokens that are still unmatched (e.g. artifacts saved by
  // older editor versions) so they can't show up as literal tag text.
  return cleaned
    .split("\n")
    .map((line) => {
      let repaired = line;
      for (const range of brokenTokenRanges(line, 0).sort(
        (a, b) => b.from - a.from,
      )) {
        repaired = repaired.slice(0, range.from) + repaired.slice(range.to);
      }
      return repaired;
    })
    .join("\n");
}

/** Strip every inline formatting tag on the lines the selection touches —
 *  the escape hatch when hidden tags trap the cursor inside formatting. */
export function clearFormatting(view: EditorView) {
  const { state } = view;
  const selection = state.selection.main;
  const firstLine = state.doc.lineAt(selection.from).number;
  const lastLine = state.doc.lineAt(selection.to).number;
  const changes = [];
  for (let number = firstLine; number <= lastLine; number++) {
    const line = state.doc.line(number);
    for (const match of line.text.matchAll(INLINE_TOKEN)) {
      changes.push({
        from: line.from + match.index!,
        to: line.from + match.index! + match[0].length,
      });
    }
  }
  if (changes.length) view.dispatch({ changes });
  view.focus();
}

function cycleHeading(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const match = /^(#{1,3})\s/.exec(line.text);
  const next = !match
    ? "## "
    : match[1].length === 1
      ? "## "
      : match[1].length === 2
        ? "### "
        : "";
  view.dispatch({
    changes: {
      from: line.from,
      to: line.from + (match?.[0].length ?? 0),
      insert: next,
    },
  });
  view.focus();
}

export function continueBullet(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const line = view.state.doc.lineAt(selection.head);
  const match = /^(\s*)([-*+])\s(.*)$/.exec(line.text);
  if (!match) return false;

  const [, indent, marker, content] = match;
  const contentStart = line.from + indent.length + 2;

  // Empty bullet + Enter = remove the bullet, stop bulleting.
  if (!content.trim()) {
    view.dispatch({
      changes: { from: line.from, to: line.to },
      selection: { anchor: line.from },
    });
    return true;
  }

  // Cursor in the indent/marker region: keep this line intact and open a
  // fresh sibling bullet below (never shove the current bullet down).
  if (selection.head < contentStart) {
    const inserted = `\n${indent}${marker} `;
    view.dispatch({
      changes: { from: line.to, insert: inserted },
      selection: { anchor: line.to + inserted.length },
    });
    return true;
  }

  // Cursor in the text: split into a sibling bullet. Close open formatting
  // on this line; reopen it on the new one only when the split carries real
  // text along — Enter at the end of a formatted run ends the formatting.
  const open = openWrappersAt(line.text, selection.head - line.from);
  const closers = [...open].reverse().map(closerFor).join("");
  const reopeners = textFollows(line.text, selection.head - line.from)
    ? open.join("")
    : "";
  const inserted = `${closers}\n${indent}${marker} ${reopeners}`;
  view.dispatch({
    changes: { from: selection.head, insert: inserted },
    selection: { anchor: selection.head + inserted.length },
  });
  return true;
}

const INLINE_TOKEN =
  /<u>|<\/u>|<mark data-color="(?:yellow|green|blue|pink)">|<\/mark>|<span data-color="(?:red|green|blue|purple)">|<\/span>|~~/g;

const closerFor = (open: string) =>
  open === "~~"
    ? "~~"
    : open === "<u>"
      ? "</u>"
      : open.startsWith("<mark")
        ? "</mark>"
        : "</span>";

const tokenKind = (token: string) =>
  token === "~~"
    ? "~~"
    : token.includes("mark")
      ? "mark"
      : token.includes("span")
        ? "span"
        : "u";

/** True when real text (not just tags/whitespace) follows `from` on the line. */
const textFollows = (lineText: string, from: number) =>
  lineText.slice(from).replace(INLINE_TOKEN, "").trim().length > 0;

/** Formatting wrappers still open at `upTo` (an offset into `lineText`). */
function openWrappersAt(lineText: string, upTo: number): string[] {
  const stack: string[] = [];
  for (const match of lineText.matchAll(INLINE_TOKEN)) {
    if (match.index! >= upTo) break;
    const token = match[0];
    if (token === "~~") {
      if (stack[stack.length - 1] === "~~") stack.pop();
      else stack.push(token);
    } else if (token.startsWith("</")) {
      stack.pop();
    } else {
      stack.push(token);
    }
  }
  return stack;
}

/** Absolute ranges of formatting tokens on a line that are unmatched or wrap
 *  nothing. Removing them keeps every wrapper balanced and non-empty. */
function brokenTokenRanges(
  text: string,
  lineFrom: number,
): { from: number; to: number }[] {
  type Token = { kind: string; from: number; to: number };
  const removals: { from: number; to: number }[] = [];
  const stack: Token[] = [];

  for (const match of text.matchAll(INLINE_TOKEN)) {
    const token = match[0];
    const from = lineFrom + match.index!;
    const to = from + token.length;
    const kind = tokenKind(token);
    const isCloser =
      token.startsWith("</") ||
      (token === "~~" && stack[stack.length - 1]?.kind === "~~");

    if (!isCloser) {
      stack.push({ kind, from, to });
    } else if (stack[stack.length - 1]?.kind === kind) {
      const open = stack.pop()!;
      if (open.to === from) {
        // empty pair — drop both halves
        removals.push({ from: open.from, to: open.to }, { from, to });
      }
    } else {
      removals.push({ from, to }); // orphan closer
    }
  }
  for (const open of stack) removals.push({ from: open.from, to: open.to });
  return removals;
}

/** After any edit, strip formatting tokens the edit left orphaned or empty,
 *  so raw tags can never become visible text. */
export const formattingJanitor = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;

  const seen = new Set<number>();
  const removals: { from: number; to: number }[] = [];
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const first = tr.newDoc.lineAt(fromB).number;
    const last = tr.newDoc.lineAt(Math.min(toB, tr.newDoc.length)).number;
    for (let number = first; number <= last; number++) {
      if (seen.has(number)) continue;
      seen.add(number);
      const line = tr.newDoc.line(number);
      removals.push(...brokenTokenRanges(line.text, line.from));
    }
  });

  if (!removals.length) return tr;
  return [tr, { changes: removals, sequential: true }];
});

export function insertJournalNewline(view: EditorView): boolean {
  if (continueBullet(view)) return true;

  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const line = view.state.doc.lineAt(selection.head);
  const open = openWrappersAt(line.text, selection.head - line.from);
  if (!open.length) return false;

  const closers = [...open].reverse().map(closerFor).join("");
  const reopeners = textFollows(line.text, selection.head - line.from)
    ? open.join("")
    : "";
  const inserted = `${closers}\n${reopeners}`;
  view.dispatch({
    changes: { from: selection.head, insert: inserted },
    selection: { anchor: selection.head + inserted.length },
  });
  return true;
}

const TAB = "    "; // one tab length

/** Tab / Shift-Tab: indent or outdent every line the selection touches by
 *  one tab length. Works from anywhere on the line; never leaves the editor. */
export function changeLineIndent(view: EditorView, outdent: boolean): boolean {
  const { state } = view;
  const selection = state.selection.main;
  const firstLine = state.doc.lineAt(selection.from).number;
  const lastLine = state.doc.lineAt(selection.to).number;

  const changes = [];
  for (let number = firstLine; number <= lastLine; number++) {
    const line = state.doc.line(number);
    if (outdent) {
      const leading = /^[ \t]*/.exec(line.text)![0];
      const remove = Math.min(TAB.length, leading.length);
      if (remove) changes.push({ from: line.from, to: line.from + remove });
    } else {
      changes.push({ from: line.from, insert: TAB });
    }
  }
  if (changes.length) view.dispatch({ changes });
  return true; // always handled — Tab never tabs out of the note
}

/** Toggle "- " bullets on every line the selection touches (format bar). */
export function toggleBullet(view: EditorView) {
  const { state } = view;
  const selection = state.selection.main;
  const firstLine = state.doc.lineAt(selection.from).number;
  const lastLine = state.doc.lineAt(selection.to).number;
  const changes = [];
  for (let number = firstLine; number <= lastLine; number++) {
    const line = state.doc.line(number);
    const bullet = /^(\s*)[-*+]\s/.exec(line.text);
    if (bullet) {
      changes.push({ from: line.from + bullet[1].length, to: line.from + bullet[0].length });
    } else {
      const indent = /^\s*/.exec(line.text)![0].length;
      changes.push({ from: line.from + indent, insert: "- " });
    }
  }
  view.dispatch({ changes });
  view.focus();
}

export function removeBulletBackward(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const line = view.state.doc.lineAt(selection.head);
  const match = /^(\s*)[-*+]\s/.exec(line.text);
  if (!match) return false;
  const contentStart = line.from + match[0].length;
  if (selection.head !== contentStart) return false;

  view.dispatch({
    changes: { from: line.from, to: contentStart },
    selection: { anchor: line.from },
  });
  return true;
}

interface Props {
  initialValue: string;
  emptyText: string;
  items: CaughtItem[];
  onChange: (value: string) => void;
  onSave: () => void;
  onTasksChange: () => void | Promise<void>;
}

export function MarkdownNoteEditor({
  initialValue,
  emptyText,
  items,
  onChange,
  onSave,
  onTasksChange,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const itemsRef = useRef(items);
  const triggerRef = useRef<(TaskTrigger & { top: number; left: number }) | null>(null);
  const dismissedTriggerRef = useRef("");
  const changingDisplayRef = useRef(false);
  const insertReferenceRef = useRef<(id: number) => void>(() => {});
  const createTaskRef = useRef<(title: string) => void>(() => {});
  const onOpenTaskRef = useRef<
    (
      id: number,
      from: number,
      display: NoteTaskDisplay,
      dom: HTMLElement,
    ) => void
  >(() => {});
  const onToggleTaskRef = useRef<(item: CaughtItem) => void>(() => {});
  const [taskTrigger, setTaskTrigger] = useState<
    (TaskTrigger & { top: number; left: number }) | null
  >(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [openTask, setOpenTask] = useState<{
    id: number;
    from: number;
    display: NoteTaskDisplay;
    top: number;
    left: number;
  } | null>(null);
  // Mobile-only: the format bar collapses to a single "Aa" toggle
  // (the toggle button is hidden on desktop, where the full bar shows).
  const [barOpen, setBarOpen] = useState(false);
  const initialValueRef = useRef(initialValue);
  const emptyTextRef = useRef(emptyText);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const refreshTrigger = (view: EditorView) => {
    const found = findTaskTrigger(
      view.state.doc.toString(),
      view.state.selection.main.head,
    );
    if (!found || !view.state.selection.main.empty) {
      triggerRef.current = null;
      setTaskTrigger(null);
      setCreatingTask(false);
      return;
    }
    const signature = `${found.from}:${found.to}:${found.query}`;
    if (signature === dismissedTriggerRef.current) return;
    const coords = view.coordsAtPos(found.to);
    const wrapper = wrapperRef.current?.getBoundingClientRect();
    if (!coords || !wrapper) return;
    const next = {
      ...found,
      top: coords.bottom - wrapper.top + 5,
      left: Math.max(8, Math.min(coords.left - wrapper.left, wrapper.width - 328)),
    };
    triggerRef.current = next;
    setTaskTrigger(next);
    setCreatingTask(false);
  };

  const insertReference = (id: number) => {
    const view = viewRef.current;
    const trigger = triggerRef.current;
    if (!view || !trigger) return;
    const token = taskToken(id, taskDisplay(undefined));
    view.dispatch({
      changes: { from: trigger.from, to: trigger.to, insert: token },
      selection: { anchor: trigger.from + token.length },
    });
    triggerRef.current = null;
    setTaskTrigger(null);
    setCreatingTask(false);
    view.focus();
  };
  insertReferenceRef.current = insertReference;

  const createTask = async (title: string) => {
    const clean = title.trim();
    if (!clean) return;
    try {
      const item = await api.addItem({ text: clean });
      itemsRef.current = [...itemsRef.current, item];
      insertReference(item.id);
      viewRef.current?.dispatch({ effects: refreshTaskObjects.of() });
      await onTasksChange();
    } catch (cause) {
      window.alert(`Could not create task: ${String(cause)}`);
    }
  };
  createTaskRef.current = (title) => void createTask(title);

  onOpenTaskRef.current = (id, from, display, dom) => {
    const wrapper = wrapperRef.current?.getBoundingClientRect();
    const object = dom.getBoundingClientRect();
    if (!wrapper) return;
    setOpenTask((current) =>
      current?.id === id && current.from === from
        ? null
        : {
            id,
            from,
            display,
            top: object.bottom - wrapper.top + 5,
            left: Math.max(8, Math.min(object.left - wrapper.left, wrapper.width - 408)),
          },
    );
    setTaskTrigger(null);
  };

  const acceptChangedTask = async (next: CaughtItem) => {
    itemsRef.current = itemsRef.current.map((item) =>
      item.id === next.id ? next : item,
    );
    viewRef.current?.dispatch({ effects: refreshTaskObjects.of() });
    await onTasksChange();
  };

  const updateReferenceDisplay = (
    id: number,
    from: number,
    display: NoteTaskDisplay,
  ) => {
    const view = viewRef.current;
    if (!view) return;
    const rest = view.state.doc.sliceString(from);
    const current = /^\{\{task:(\d+)(?:\|show=[a-z,]*)?\}\}/.exec(rest);
    if (!current || Number(current[1]) !== id) return;
    changingDisplayRef.current = true;
    view.dispatch({
      changes: {
        from,
        to: from + current[0].length,
        insert: taskToken(id, display),
      },
    });
    changingDisplayRef.current = false;
    setOpenTask((open) => (open ? { ...open, display } : open));
  };

  onToggleTaskRef.current = (item) => {
    if (
      item.status !== "closed" &&
      item.source === "linear" &&
      !window.confirm(`Complete ${item.linear_identifier ?? "this task"} in Linear?`)
    ) {
      return;
    }
    void (item.status === "closed" ? api.reopenItem(item.id) : api.closeItem(item.id))
      .then(acceptChangedTask)
      .catch((cause) => window.alert(`Could not update task: ${String(cause)}`));
  };

  useEffect(() => {
    itemsRef.current = items;
    viewRef.current?.dispatch({ effects: refreshTaskObjects.of() });
  }, [items]);

  useEffect(() => {
    if (!hostRef.current) return;

    const cleanValue = cleanFormatting(initialValueRef.current);
    const state = EditorState.create({
      doc: cleanValue,
      extensions: [
        history(),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle),
        codeFolding({
          placeholderDOM: (_view, onclick) => {
            const marker = document.createElement("span");
            marker.className = "cm-note-fold-marker";
            marker.textContent = "⋯";
            marker.title = "show hidden notes";
            marker.setAttribute("role", "button");
            marker.setAttribute("aria-label", "show hidden notes");
            marker.onclick = onclick;
            return marker;
          },
        }),
        listFolding,
        bulletPlugin,
        richTextPlugin,
        taskObjects(itemsRef, onOpenTaskRef, onToggleTaskRef),
        formattingJanitor,
        indentUnit.of(TAB),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          spellcheck: "true",
          "aria-label": "Journal note",
        }),
        placeholder(emptyTextRef.current),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current();
              return true;
            },
          },
          {
            key: "Mod-u",
            preventDefault: true,
            run: (view) => {
              wrapSelection(view, "<u>", "</u>");
              return true;
            },
          },
          {
            key: "Mod-Shift-x",
            run: (view) => {
              wrapSelection(view, "~~", "~~");
              return true;
            },
          },
          {
            key: "Mod-\\",
            preventDefault: true,
            run: (view) => {
              clearFormatting(view);
              return true;
            },
          },
          {
            key: "Enter",
            run: (view) => {
              const trigger = triggerRef.current;
              if (trigger) {
                const match = matchingTasks(itemsRef.current, trigger.query)[0];
                if (match) insertReferenceRef.current(match.id);
                else if (trigger.query) createTaskRef.current(trigger.query);
                else return false;
                return true;
              }
              return insertJournalNewline(view);
            },
          },
          {
            key: "Escape",
            run: () => {
              const trigger = triggerRef.current;
              if (!trigger) return false;
              dismissedTriggerRef.current = `${trigger.from}:${trigger.to}:${trigger.query}`;
              triggerRef.current = null;
              setTaskTrigger(null);
              setCreatingTask(false);
              return true;
            },
          },
          {
            key: "Backspace",
            run: removeBulletBackward,
          },
          {
            key: "Tab",
            preventDefault: true,
            run: (view) => changeLineIndent(view, false),
          },
          {
            key: "Shift-Tab",
            preventDefault: true,
            run: (view) => changeLineIndent(view, true),
          },
          ...foldKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
            if (!changingDisplayRef.current) setOpenTask(null);
          }
          if (update.docChanged || update.selectionSet) refreshTrigger(update.view);
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    if (cleanValue !== initialValueRef.current) {
      onChangeRef.current(cleanValue);
    }
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  const wrap = (open: string, close: string) => {
    if (viewRef.current) wrapSelection(viewRef.current, open, close);
  };
  const indent = (outdent: boolean) => {
    if (!viewRef.current) return;
    changeLineIndent(viewRef.current, outdent);
    viewRef.current.focus();
  };
  const matches = taskTrigger
    ? matchingTasks(items, taskTrigger.query)
    : [];
  const openedItem = openTask
    ? itemsRef.current.find((item) => item.id === openTask.id)
    : undefined;

  return (
    <div className="note-editor" ref={wrapperRef}>
      {/* mousedown preventDefault keeps the editor focused (and the mobile
          keyboard up) while tapping formatting buttons */}
      <div
        className={`note-formatbar${barOpen ? " open" : ""}`}
        aria-label="Text formatting"
        onMouseDown={(event) => event.preventDefault()}
      >
        <button
          type="button"
          className="note-format-bullet"
          title="toggle bullet"
          onClick={() => viewRef.current && toggleBullet(viewRef.current)}
        >
          •
        </button>
        <button type="button" title="outdent line (⇧⇥)" onClick={() => indent(true)}>
          ⇤
        </button>
        <button type="button" title="indent line (⇥)" onClick={() => indent(false)}>
          ⇥
        </button>
        <span className="note-format-divider" />
        <button type="button" title="cycle heading" onClick={() => viewRef.current && cycleHeading(viewRef.current)}>
          H
        </button>
        <button type="button" title="underline (⌘U)" onClick={() => wrap("<u>", "</u>")}>
          <u>U</u>
        </button>
        <button type="button" title="strikethrough (⌘⇧X)" onClick={() => wrap("~~", "~~")}>
          <s>S</s>
        </button>
        <button
          type="button"
          title="clear formatting on selected lines (⌘\)"
          onClick={() => viewRef.current && clearFormatting(viewRef.current)}
        >
          Tx
        </button>
        {(["yellow", "green", "blue", "pink"] as const).map((color) => (
          <button
            key={color}
            type="button"
            className={`note-color ${color}`}
            title={`${color} highlight`}
            aria-label={`${color} highlight`}
            onClick={() =>
              wrap(`<mark data-color="${color}">`, "</mark>")
            }
          />
        ))}
        <span className="note-format-divider" />
        {(["red", "green", "blue", "purple"] as const).map((color) => (
          <button
            key={color}
            type="button"
            className={`note-text-color ${color}`}
            title={`${color} text`}
            aria-label={`${color} text`}
            onClick={() =>
              wrap(`<span data-color="${color}">`, "</span>")
            }
          >
            A
          </button>
        ))}
        <button
          type="button"
          className="note-format-toggle"
          title={barOpen ? "hide formatting tools" : "show formatting tools"}
          onClick={() => setBarOpen((open) => !open)}
        >
          {barOpen ? "›" : "Aa"}
        </button>
      </div>
      <div className="daynotes-input" ref={hostRef} />
      {taskTrigger && (
        <div
          className="note-task-picker"
          style={{ top: taskTrigger.top, left: taskTrigger.left }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {creatingTask ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                createTaskRef.current(newTaskTitle);
              }}
            >
              <input
                autoFocus
                value={newTaskTitle}
                placeholder="task title"
                onChange={(event) => setNewTaskTitle(event.target.value)}
              />
              <button type="submit" disabled={!newTaskTitle.trim()}>create</button>
            </form>
          ) : (
            <>
              <button
                type="button"
                className="note-task-new"
                onClick={() => {
                  if (taskTrigger.query) createTaskRef.current(taskTrigger.query);
                  else {
                    setNewTaskTitle("");
                    setCreatingTask(true);
                  }
                }}
              >
                + new{taskTrigger.query ? ` “${taskTrigger.query}”` : " task"}
              </button>
              {matches.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="note-task-result"
                  onClick={() => insertReferenceRef.current(item.id)}
                >
                  <span>{item.status === "closed" ? "✓" : "○"}</span>
                  <span>{item.text}</span>
                  <small>
                    {item.source === "linear"
                      ? `L · ${item.linear_identifier}`
                      : item.assignee
                        ? `@${item.assignee}`
                        : "local"}
                  </small>
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {openTask && openedItem && (
        <div
          className="note-task-details-position"
          style={{ top: openTask.top, left: openTask.left }}
        >
          <NoteTaskDetails
            item={openedItem}
            display={openTask.display}
            onChanged={(next) => void acceptChangedTask(next)}
            onDisplayChange={(display) =>
              updateReferenceDisplay(openTask.id, openTask.from, display)
            }
            onClose={() => setOpenTask(null)}
          />
        </div>
      )}
    </div>
  );
}
