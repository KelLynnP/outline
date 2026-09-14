// State-level behavior tests for the notes editor key schema and the
// formatting janitor. No DOM needed — handlers only use state + dispatch.
//
//   npx tsx frontend/src/components/MarkdownNoteEditor.test.ts

import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { CaughtItem } from "@life-console/shared";
import {
  changeLineIndent,
  cleanFormatting,
  clearFormatting,
  continueBullet,
  findTaskTrigger,
  formattingJanitor,
  insertJournalNewline,
  matchingTasks,
  removeBulletBackward,
  taskReferences,
  taskToken,
} from "./MarkdownNoteEditor.js";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.log(
      `FAIL ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`,
    );
  }
}

/** Minimal stand-in for an EditorView: just state + dispatch. */
function makeView(doc: string, cursor: number) {
  let state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [formattingJanitor],
  });
  return {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
    focus() {},
  } as unknown as EditorView & { state: EditorState };
}

// --- Enter on bullets -------------------------------------------------------

{
  const view = makeView("- hello", 7); // cursor at end
  continueBullet(view);
  check("enter at end → sibling bullet below", view.state.doc.toString(), "- hello\n- ");
  check("… cursor on the new bullet", view.state.selection.main.head, 10);
}

{
  const view = makeView("- hello", 4); // cursor mid-text: "- he|llo"
  continueBullet(view);
  check("enter mid-text → splits into sibling", view.state.doc.toString(), "- he\n- llo");
}

{
  const view = makeView("- hello", 0); // cursor in the marker region
  continueBullet(view);
  check(
    "enter in marker region → line stays, new bullet below",
    view.state.doc.toString(),
    "- hello\n- ",
  );
}

{
  const view = makeView("- ", 2); // empty bullet
  continueBullet(view);
  check("enter on empty bullet → stops bulleting", view.state.doc.toString(), "");
}

{
  const view = makeView("  - deep", 8); // nested bullet keeps its indent
  continueBullet(view);
  check("enter keeps indent level", view.state.doc.toString(), "  - deep\n  - ");
}

// --- Enter inside formatting ------------------------------------------------

{
  const view = makeView("- <u>hello</u>", 7); // "- <u>he|llo</u>"
  continueBullet(view);
  check(
    "enter inside underline → closed and reopened per line",
    view.state.doc.toString(),
    "- <u>he</u>\n- <u>llo</u>",
  );
}

{
  const view = makeView("<u>hello</u>", 8); // plain line, cursor after "hello"
  insertJournalNewline(view);
  check(
    "newline after formatted word → no empty wrapper left behind",
    view.state.doc.toString(),
    "<u>hello</u>\n",
  );
}

{
  const view = makeView("- <u>hello</u>", 10); // cursor at end of underlined text
  continueBullet(view);
  check(
    "enter at end of formatting → new bullet starts unformatted",
    view.state.doc.toString(),
    "- <u>hello</u>\n- ",
  );
}

{
  const view = makeView("<u>hello </u>", 8); // trailing space inside wrapper
  insertJournalNewline(view);
  check(
    "enter before trailing space → new line starts unformatted",
    view.state.doc.toString(),
    "<u>hello</u>\n ",
  );
}

// --- Clear formatting ---------------------------------------------------------

{
  const view = makeView('<u>a</u> and <mark data-color="green">b</mark>', 0);
  clearFormatting(view);
  check("clear formatting strips every tag on the line", view.state.doc.toString(), "a and b");
}

// --- Tab / Shift-Tab ---------------------------------------------------------

{
  const view = makeView("- hello", 3); // cursor anywhere on the line
  changeLineIndent(view, false);
  check("tab indents one tab length", view.state.doc.toString(), "    - hello");
  changeLineIndent(view, true);
  check("shift-tab outdents back", view.state.doc.toString(), "- hello");
  changeLineIndent(view, true);
  check("shift-tab at zero indent is a no-op", view.state.doc.toString(), "- hello");
}

{
  const view = makeView("- a\n- b", 0);
  view.dispatch({ selection: { anchor: 0, head: 7 } });
  changeLineIndent(view, false);
  check("tab indents every selected line", view.state.doc.toString(), "    - a\n    - b");
}

// --- Backspace on a bullet ---------------------------------------------------

{
  const view = makeView("- hello", 2); // cursor at content start
  removeBulletBackward(view);
  check("backspace at bullet start removes the bullet", view.state.doc.toString(), "hello");
}

// --- Formatting janitor (runs on every edit) ---------------------------------

{
  const view = makeView("<u>hello</u>", 0);
  view.dispatch({ changes: { from: 8, to: 12 } }); // delete the closer
  check("deleting a closer also removes its opener", view.state.doc.toString(), "hello");
}

{
  const view = makeView("<u>a</u>", 0);
  view.dispatch({ changes: { from: 3, to: 4 } }); // delete the only content
  check("emptying a wrapper removes both tags", view.state.doc.toString(), "");
}

{
  const view = makeView('<mark data-color="green">hi</mark> there', 0);
  view.dispatch({ changes: { from: 0, to: 25 } }); // delete the opener
  check("deleting an opener also removes its closer", view.state.doc.toString(), "hi there");
}

// --- Load-time repair of previously saved artifacts ---------------------------

check("orphan opener stripped on load", cleanFormatting("<u>He llo"), "He llo");
check(
  "multiline wrapper re-balanced on load",
  cleanFormatting("<u>He\nllo</u>"),
  "<u>He</u>\n<u>llo</u>",
);
check(
  "empty wrappers dropped on load",
  cleanFormatting('<mark data-color="green"><mark data-color="yellow"></mark></mark>'),
  "",
);

// --- Task objects -------------------------------------------------------------

check(
  "empty task trigger",
  findTaskTrigger("    - []", 8),
  { from: 6, to: 8, query: "" },
);
check(
  "task trigger carries lookup text",
  findTaskTrigger("- [] tread tuning", 17),
  { from: 2, to: 17, query: "tread tuning" },
);
check("task trigger must start at a word boundary", findTaskTrigger("word[]", 6), null);
check(
  "task references preserve duplicate insertions",
  taskReferences("{{task:12}}\n- {{task:12|show=due,tags}}\n{{task:7}}"),
  [12, 12, 7],
);
check(
  "default task display keeps the short token",
  taskToken(12, { linear: true, assignee: true, due: true, tags: true }),
  "{{task:12}}",
);
check(
  "task display choices persist in its reference",
  taskToken(12, { linear: false, assignee: true, due: true, tags: false }),
  "{{task:12|show=assignee,due}}",
);

const task = (id: number, text: string, linearIdentifier: string | null = null) =>
  ({
    id,
    text,
    status: "open",
    source: linearIdentifier ? "linear" : "manual",
    linear_identifier: linearIdentifier,
    linear_team: linearIdentifier ? "ROB" : null,
    assignee: id === 1 ? "Winston" : null,
    tags: id === 1 ? ["robot"] : [],
  }) as CaughtItem;
const lookupItems = [
  task(1, "Pick tread tuning values"),
  task(2, "Review engineer resumes", "ROB-42"),
];
check(
  "task lookup searches assignee",
  matchingTasks(lookupItems, "winston").map((item) => item.id),
  [1],
);
check(
  "task lookup searches Linear identifier",
  matchingTasks(lookupItems, "ROB-42").map((item) => item.id),
  [2],
);

// ------------------------------------------------------------------------------

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall tests passed");
