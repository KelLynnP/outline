import { useEffect, useRef, useState } from "react";
import {
  localDateISO,
  type CaughtItem,
  type LinearTeam,
  type Priority,
  type Settings,
} from "@life-console/shared";
import { api } from "../api.js";
import { taskDragProps, taskDropProps } from "../dnd.js";
import { fmt12 } from "../time.js";
import { useToggle } from "../useToggle.js";
import { tagColors } from "../colors.js";

/** Close modals on Escape (clicking the overlay already closes them). */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
}

interface Props {
  settings: Settings;
  onCreated: () => void;
  compact?: boolean;
}

export function TaskComposer({ settings, onCreated, compact = false }: Props) {
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>(2);
  const [tagInput, setTagInput] = useState("");
  const [assignee, setAssignee] = useState("");
  const [urgent, setUrgent] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    const tags = tagInput
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    await api.addItem({
      text: text.trim(),
      tag: urgent ? settings.tags.urgent : settings.tags.normal,
      due_date: dueDate || null,
      priority,
      tags,
      assignee: assignee || null,
    });
    setText("");
    setDueDate("");
    setPriority(2);
    setTagInput("");
    setAssignee("");
    setUrgent(false);
    onCreated();
  };

  return (
    <div className={`composer ${compact ? "composer-compact" : ""}`}>
      <input
        className="composer-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey || compact)) submit();
        }}
        placeholder="capture a task…"
      />
      <div className="composer-row">
        <div className="composer-prio" role="radiogroup">
          {[1, 2, 3].map((p) => (
            <button
              key={p}
              className={`prio prio-${p} ${priority === p ? "active" : ""}`}
              onClick={() => setPriority(p as Priority)}
              title={`P${p}`}
            >
              P{p}
            </button>
          ))}
        </div>
        <input
          type="date"
          className="composer-date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <input
          className="composer-tags"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          placeholder="@person"
        />
        <input
          className="composer-tags"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          placeholder="tags (comma)"
        />
        <label className="composer-urgent">
          <input
            type="checkbox"
            checked={urgent}
            onChange={(e) => setUrgent(e.target.checked)}
          />
          urgent
        </label>
        <button className="composer-submit" onClick={submit}>
          add
        </button>
      </div>
    </div>
  );
}

export function TaskMeta({ item }: { item: CaughtItem }) {
  const due = item.due_date ? new Date(item.due_date + "T00:00:00") : null;
  const now = new Date();
  const daysUntil = due
    ? Math.ceil((due.getTime() - now.getTime()) / 86400_000)
    : null;
  const dueClass =
    daysUntil === null
      ? ""
      : daysUntil < 0
        ? "overdue"
        : daysUntil <= 1
          ? "soon"
          : "later";
  return (
    <span className="task-meta">
      <span className={`prio-chip prio-${item.priority}`}>P{item.priority}</span>
      {due && (
        <span className={`due-chip ${dueClass}`}>
          {daysUntil !== null && daysUntil < 0
            ? `${-daysUntil}d overdue`
            : daysUntil === 0
              ? "today"
              : daysUntil === 1
                ? "tomorrow"
                : due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      )}
      {item.tags.map((t) => (
        <span key={t} className="tag-chip">
          #{t}
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* TaskTable: sectioned task board.                                    */
/*   today's tasks / unscheduled / scheduled ahead / done              */
/* Each section (and each tag subgroup within) is a persisted toggle.  */
/* ------------------------------------------------------------------ */

const shortDate = (isoDate: string) =>
  new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

const byPrioThenDue = (a: CaughtItem, b: CaughtItem) =>
  a.priority - b.priority ||
  (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");

function childrenOf(all: CaughtItem[], parentId: number): CaughtItem[] {
  return all.filter((i) => i.parent_id === parentId).sort(byPrioThenDue);
}

/** Signal-strength style priority indicator (3 bars, more = more urgent). */
function PrioBars({
  priority,
  onClick,
}: {
  priority: Priority;
  onClick: () => void;
}) {
  return (
    <button
      className={`prio-bars p${priority}`}
      title={`P${priority} — click to change`}
      onClick={onClick}
    >
      <i />
      <i />
      <i />
    </button>
  );
}

/** "Jul 20 · 1:45p" for full ISO timestamps, "Jul 20" for date-only. */
function doneLabel(closed: string): string {
  if (!closed.includes("T")) return shortDate(closed);
  const d = new Date(closed);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .toLowerCase()
    .replace(" ", "")}`;
}

export function TaskTable({
  items,
  settings,
  onChange,
  scheduleToday,
}: {
  items: CaughtItem[];
  settings: Settings;
  onChange: () => void;
  /** Drop a task on "today's tasks" to put it on today's calendar. */
  scheduleToday?: (itemId: number) => void | Promise<void>;
}) {
  const today = localDateISO();
  // View filter: everything, or only Linear-synced rows (optionally one team).
  const [linearView, toggleLinearView] = useToggle("tasks.view.linear", false);
  const [team, setTeam] = useState("all");
  const teams = [...new Set(items.map((i) => i.linear_team).filter(Boolean))].sort() as string[];
  const visible = linearView
    ? items.filter(
        (i) => i.source === "linear" && (team === "all" || i.linear_team === team),
      )
    : items;

  const open = visible.filter((i) => i.status !== "closed");
  // Archived notes just disappear; only real tasks show in "done".
  const done = visible
    .filter((i) => i.status === "closed" && i.kind !== "note")
    .sort((a, b) => (b.closed_date ?? "").localeCompare(a.closed_date ?? ""))
    .slice(0, 20);

  // Two views of the same tasks (intentional): a flat "what's on today"
  // list, and the full to-do list (tag groups + nesting).
  const todays = open
    .filter((i) => i.scheduled_date === today)
    .sort((a, b) =>
      (a.scheduled_time ?? "99:99").localeCompare(b.scheduled_time ?? "99:99"),
    );
  const roots = open.filter((i) => !i.parent_id);
  // Load view: any assigned open task (including nested ones), flat by person.
  const assigned = open.filter((i) => i.assignee);

  return (
    <div className="taskboard">
      {teams.length > 0 && (
        <div className="tb-viewbar">
          <button
            className={`tog ${!linearView ? "on" : ""}`}
            onClick={() => linearView && toggleLinearView()}
          >
            all
          </button>
          <button
            className={`tog ${linearView ? "on" : ""}`}
            onClick={() => !linearView && toggleLinearView()}
          >
            linear
          </button>
          {linearView && (
            <>
              <select value={team} onChange={(e) => setTeam(e.target.value)}>
                <option value="all">all teams</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                className="row-icon"
                title="sync with Linear now"
                onClick={async () => {
                  await api.syncLinear();
                  onChange();
                }}
              >
                ↻
              </button>
            </>
          )}
        </div>
      )}
      {!linearView && <Composer settings={settings} onCreated={onChange} />}
      <Section
        id="today"
        label="today"
        items={todays}
        allOpen={open}
        onChange={onChange}
        flat
        onDropItem={
          scheduleToday &&
          (async (id) => {
            await scheduleToday(id);
            onChange();
          })
        }
      />
      <Section id="all" label="to dos" items={roots} allOpen={open} onChange={onChange} />
      <PersonSection items={assigned} allOpen={open} onChange={onChange} />
      <Section
        id="done"
        label="done"
        items={done.filter((i) => !i.parent_id)}
        allOpen={visible}
        onChange={onChange}
        flat
        onDropItem={async (id) => {
          await api.closeItem(id);
          onChange();
        }}
      />
    </div>
  );
}

/** Group open assigned tasks by person — internal load / deadline view. */
function PersonSection({
  items,
  allOpen,
  onChange,
}: {
  items: CaughtItem[];
  allOpen: CaughtItem[];
  onChange: () => void;
}) {
  const [open, toggle] = useToggle("tasks.sec.people", true);
  const groups = new Map<string, CaughtItem[]>();
  for (const it of items) {
    const who = it.assignee!;
    (groups.get(who) ?? groups.set(who, []).get(who)!).push(it);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="tb-section">
      <button className="tb-section-head" onClick={toggle}>
        {open ? "▾" : "▸"} by person{" "}
        <span className="quiet">({items.length})</span>
      </button>
      {open &&
        (ordered.length === 0 ? (
          <div className="quiet tb-empty">
            nothing assigned — set @person + due when creating or editing a task.
          </div>
        ) : (
          ordered.map(([who, rows]) => {
            const c = tagColors(who);
            return (
              <div key={who} className="tb-taggroup">
                <div className="tb-tag-head" style={{ cursor: "default" }}>
                  <i className="tag-dot" style={{ background: c.border }} /> @{who}{" "}
                  <span className="quiet">({rows.length})</span>
                </div>
                <div className="tb-rows">
                  {[...rows].sort(byPrioThenDue).map((it) => (
                    <Row
                      key={it.id}
                      item={it}
                      allOpen={allOpen}
                      onChange={onChange}
                      depth={0}
                      showNest={false}
                    />
                  ))}
                </div>
              </div>
            );
          })
        ))}
    </div>
  );
}

function Section({
  id,
  label,
  items,
  allOpen,
  onChange,
  flat = false,
  onDropItem,
}: {
  id: string;
  label: string;
  items: CaughtItem[];
  allOpen: CaughtItem[];
  onChange: () => void;
  flat?: boolean; // no tag subgroups (used by "done")
  onDropItem?: (id: number) => void | Promise<void>;
}) {
  const [open, toggle] = useToggle(`tasks.sec.${id}`, true);

  // Subgroup by first tag; untagged fall into "other", sorted last.
  // All of a task's tags still show on the row — this is just grouping.
  const groups = new Map<string, CaughtItem[]>();
  for (const it of items) {
    const tag = flat ? "" : (it.tags[0] ?? "other");
    (groups.get(tag) ?? groups.set(tag, []).get(tag)!).push(it);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === "other" ? 1 : b === "other" ? -1 : a.localeCompare(b),
  );

  return (
    <div
      className="tb-section"
      {...(onDropItem ? taskDropProps((id) => void onDropItem(id)) : {})}
    >
      <button className="tb-section-head" onClick={toggle}>
        {open ? "▾" : "▸"} {label} <span className="quiet">({items.length})</span>
      </button>
      {open &&
        (flat ? (
          <div className="tb-rows">
            {items.map((it) => (
              <Row
                key={it.id}
                item={it}
                allOpen={allOpen}
                onChange={onChange}
                done={id === "done"}
                depth={0}
                showNest={false}
              />
            ))}
            {items.length === 0 && <div className="quiet tb-empty">nothing here.</div>}
          </div>
        ) : (
          <>
            {ordered.map(([tag, rows]) => (
              <TagGroup
                key={tag}
                sectionId={id}
                tag={tag}
                rows={rows}
                allOpen={allOpen}
                onChange={onChange}
              />
            ))}
            {items.length === 0 && <div className="quiet tb-empty">nothing here.</div>}
          </>
        ))}
    </div>
  );
}

function TagGroup({
  sectionId,
  tag,
  rows,
  allOpen,
  onChange,
}: {
  sectionId: string;
  tag: string;
  rows: CaughtItem[];
  allOpen: CaughtItem[];
  onChange: () => void;
}) {
  const [open, toggle] = useToggle(`tasks.sub.${sectionId}.${tag}`, true);
  const c = tagColors(tag);
  return (
    <div className="tb-taggroup">
      <button
        className="tb-tag-head"
        onClick={toggle}
        title="drop a nested task here to unnest it"
        {...taskDropProps(async (id) => {
          await api.updateItem(id, { parent_id: null });
          onChange();
        }, "nest-over")}
      >
        {open ? "▾" : "▸"} <i className="tag-dot" style={{ background: c.border }} />{" "}
        {tag} <span className="quiet">({rows.length})</span>
      </button>
      {open && (
        <div className="tb-rows">
          {[...rows].sort(byPrioThenDue).map((it) => (
            <Row
              key={it.id}
              item={it}
              allOpen={allOpen}
              onChange={onChange}
              hideTag={tag}
              depth={0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  item,
  allOpen,
  onChange,
  done = false,
  hideTag,
  depth = 0,
  showNest = true,
}: {
  item: CaughtItem;
  allOpen: CaughtItem[];
  onChange: () => void;
  done?: boolean;
  hideTag?: string;
  depth?: number;
  /** When false (e.g. by-person flat view), don't render nested children. */
  showNest?: boolean;
}) {
  const kids = showNest && !done ? childrenOf(allOpen, item.id) : [];
  // Linear owns text/priority/due/assignee on synced rows — edit them there.
  // Tags, nesting, and scheduling stay local-only and editable.
  const isLinear = item.source === "linear";
  const [expanded, setExpanded] = useState(kids.length > 0);
  const [addingSub, setAddingSub] = useState(false);
  const [sendingToLinear, setSendingToLinear] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editTags, setEditTags] = useState<string | null>(null);
  const [editWho, setEditWho] = useState<string | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const today = localDateISO();
  const overdue = !done && item.due_date && item.due_date < today;
  // Show every tag on the row (multiple tags); only hide the group key.
  const extraTags = item.tags.filter((t) => t !== hideTag);
  const editing = editTags !== null || editWho !== null;

  // A row accepts other tasks (to nest them) but must ignore its own drag:
  // otherwise the source row claims the drag at dragstart (the cursor starts
  // on top of it), which breaks dragging rows out to the calendar.
  const nestDrop =
    showNest && !done
      ? taskDropProps(
          async (id) => {
            if (id === item.id) return;
            await api.updateItem(id, { parent_id: item.id });
            setExpanded(true);
            onChange();
          },
          "nest-over",
          item.id,
        )
      : {};

  const saveTags = async () => {
    const raw = editTags ?? "";
    setEditTags(null);
    const tags = raw
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    if (tags.join(",") !== item.tags.join(",")) {
      await api.updateItem(item.id, { tags });
      onChange();
    }
  };
  const saveWho = async () => {
    const next = (editWho ?? "").trim().replace(/^@+/, "") || null;
    setEditWho(null);
    if (next !== (item.assignee ?? null)) {
      await api.updateItem(item.id, { assignee: next });
      onChange();
    }
  };
  const openDatePicker = () => dateRef.current?.showPicker();

  return (
    <>
    <div
      className={`task-row ${done ? "done" : ""} ${overdue ? "overdue" : ""} ${depth ? "nested" : ""} ${item.kind === "note" ? "note" : ""}`}
      style={{ paddingLeft: 12 + depth * 18 }}
      data-item-id={item.id}
      {...(!editing && !done ? taskDragProps(item.id) : {})}
      {...nestDrop}
    >
      <span className="drag-handle" title="drag onto the calendar, or onto a task to nest">⋮⋮</span>
      {showNest && (kids.length > 0 || !done) ? (
        <button
          className={`tree-toggle ${kids.length ? "" : "empty"}`}
          title={kids.length ? (expanded ? "collapse" : "expand") : "add subtask"}
          onClick={() => {
            if (kids.length) setExpanded(!expanded);
            else {
              setExpanded(true);
              setAddingSub(true);
            }
          }}
        >
          {kids.length ? (expanded ? "▾" : "▸") : "·"}
        </button>
      ) : (
        <span className="tree-toggle empty" />
      )}
      {item.kind === "note" ? (
        <span className="note-mark" title="note — nothing to check off">~</span>
      ) : (
        <button
          className={`task-check ${done ? "on" : ""}`}
          title={done ? "reopen" : "complete"}
          onClick={async () => {
            if (done) await api.reopenItem(item.id);
            else await api.closeItem(item.id);
            onChange();
          }}
        />
      )}
      {item.kind !== "note" && (
        <PrioBars
          priority={item.priority}
          onClick={async () => {
            if (isLinear) return;
            await api.updateItem(item.id, {
              priority: ((item.priority % 3) + 1) as Priority,
            });
            onChange();
          }}
        />
      )}
      <span
        className="task-row-text"
        title="click for details · drop a task here to nest under it"
        onClick={() => setDetailOpen(true)}
      >
        {item.tag === "#c!" && <span className="tag-c urgent">!</span>}
        {item.text}
        {item.description && (
          <span className="desc-mark" title="has description">
            ≡
          </span>
        )}
        {kids.length > 0 && (
          <span className="quiet child-count"> · {kids.length}</span>
        )}
      </span>
      {isLinear && (
        <a
          className="chip linear-chip"
          href={item.source_deeplink ?? undefined}
          target="_blank"
          rel="noreferrer"
          title={`${item.linear_identifier} — open in Linear`}
        >
          <b>L</b>
          {item.linear_identifier}
        </a>
      )}
      {isLinear && !done && item.linear_state_type === "backlog" && (
        <span className="chip state-chip">backlog</span>
      )}
      {isLinear && !done && item.linear_state_type === "started" && (
        <span className="chip state-chip started">{item.linear_state ?? "in progress"}</span>
      )}
      {editTags !== null ? (
        <input
          className="tag-edit-input"
          autoFocus
          value={editTags}
          placeholder="tags, comma separated"
          onChange={(e) => setEditTags(e.target.value)}
          onBlur={saveTags}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveTags();
            if (e.key === "Escape") setEditTags(null);
          }}
        />
      ) : (
        <>
          {extraTags.map((t) => {
            const c = tagColors(t);
            return (
              <button
                key={t}
                className="tag-chip tag-chip-btn"
                style={{ background: c.bg, color: c.ink }}
                title="edit tags"
                onClick={() => !done && setEditTags(item.tags.join(", "))}
              >
                #{t}
              </button>
            );
          })}
          {!done && (
            <button
              className="row-icon"
              title="edit tags"
              onClick={() => setEditTags(item.tags.join(", "))}
            >
              #
            </button>
          )}
        </>
      )}
      {editWho !== null ? (
        <input
          className="who-edit-input"
          autoFocus
          value={editWho}
          placeholder="@person"
          onChange={(e) => setEditWho(e.target.value)}
          onBlur={saveWho}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveWho();
            if (e.key === "Escape") setEditWho(null);
          }}
        />
      ) : item.assignee ? (
        <button
          className="chip who"
          style={{
            background: tagColors(item.assignee).bg,
            color: tagColors(item.assignee).ink,
          }}
          title={isLinear ? "assignee synced from Linear" : "change assignee"}
          onClick={() => !done && !isLinear && setEditWho(item.assignee ?? "")}
        >
          @{item.assignee}
        </button>
      ) : (
        !done &&
        !isLinear && (
          <button
            className="row-icon"
            title="assign to someone"
            onClick={() => setEditWho("")}
          >
            @
          </button>
        )
      )}
      {done && item.closed_date && (
        <span className="chip done-at" title="completed">
          {doneLabel(item.closed_date)}
        </span>
      )}
      {item.scheduled_date && !done && (
        <span className="chip sched" title="on the calendar">
          {item.scheduled_date === today
            ? item.scheduled_time
              ? fmt12(item.scheduled_time)
              : "today"
            : `${shortDate(item.scheduled_date)}${item.scheduled_time ? ` ${fmt12(item.scheduled_time)}` : ""}`}
        </span>
      )}
      {!done && (item.due_date || !isLinear) && (
        <span className="due-wrap">
          <button
            className={`chip due ${overdue ? "overdue" : ""} ${item.due_date ? "" : "empty"}`}
            title={
              isLinear
                ? "due date synced from Linear"
                : item.due_date
                  ? "due date — click to change"
                  : "set due date"
            }
            onClick={() => !isLinear && openDatePicker()}
          >
            {item.due_date ? shortDate(item.due_date) : "due"}
          </button>
          <input
            ref={dateRef}
            type="date"
            className="chip-date-input"
            tabIndex={-1}
            aria-hidden
            value={item.due_date ?? ""}
            onChange={async (e) => {
              await api.updateItem(item.id, { due_date: e.target.value || null });
              onChange();
            }}
          />
        </span>
      )}
      {item.scheduled_date && !done && (
        <button
          className="row-icon"
          title="unschedule (keep the task)"
          onClick={async () => {
            await api.unscheduleItem(item.id);
            onChange();
          }}
        >
          ↩
        </button>
      )}
      {item.parent_id && !done && showNest && (
        <button
          className="row-icon"
          title="unnest (promote to top level)"
          onClick={async () => {
            await api.updateItem(item.id, { parent_id: null });
            onChange();
          }}
        >
          ↖
        </button>
      )}
      {showNest && !done && (
        <button
          className="row-icon"
          title="add subtask"
          onClick={() => {
            setExpanded(true);
            setAddingSub(true);
          }}
        >
          +
        </button>
      )}
      {!done && !isLinear && item.kind !== "note" && (
        <button
          className="row-icon"
          title="send to Linear"
          onClick={() => setSendingToLinear(true)}
        >
          L
        </button>
      )}
      {!done && isLinear && (
        <button
          className="row-icon"
          title="detach from Linear (keep as a local task; the issue stays)"
          onClick={async () => {
            await api.detachLinear(item.id);
            onChange();
          }}
        >
          ⇤
        </button>
      )}
      {item.kind === "note" && !done && (
        <button
          className="row-icon"
          title="archive this note"
          onClick={async () => {
            await api.closeItem(item.id);
            onChange();
          }}
        >
          ×
        </button>
      )}
    </div>
    {showNest && expanded && (
      <>
        {kids.map((c) => (
          <Row
            key={c.id}
            item={c}
            allOpen={allOpen}
            onChange={onChange}
            hideTag={hideTag}
            depth={depth + 1}
          />
        ))}
        {addingSub && (
          <SubComposer
            parentId={item.id}
            depth={depth + 1}
            onDone={() => {
              setAddingSub(false);
              onChange();
            }}
            onCancel={() => setAddingSub(false)}
          />
        )}
      </>
    )}
    {sendingToLinear && (
      <LinearSendModal
        draft={{
          text: item.text,
          description: item.description,
          due_date: item.due_date,
          priority: item.priority,
        }}
        itemId={item.id}
        onDone={() => {
          setSendingToLinear(false);
          onChange();
        }}
        onCancel={() => setSendingToLinear(false)}
      />
    )}
    {detailOpen && (
      <TaskDetailModal
        item={item}
        onChange={onChange}
        onClose={() => setDetailOpen(false)}
      />
    )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* TaskDetailModal: click a task to see everything on it.              */
/* Title + description are editable for local tasks; Linear rows are   */
/* read-only here (Linear owns them) with a jump-out link.             */
/* ------------------------------------------------------------------ */

function TaskDetailModal({
  item,
  onChange,
  onClose,
}: {
  item: CaughtItem;
  onChange: () => void;
  onClose: () => void;
}) {
  const isLinear = item.source === "linear";
  const [title, setTitle] = useState(item.text);
  const [description, setDescription] = useState(item.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);
  const dirty =
    !isLinear &&
    (title.trim() !== item.text ||
      (description.trim() || null) !== (item.description ?? null));

  const save = async () => {
    if (!dirty || busy || !title.trim()) return;
    setBusy(true);
    await api.updateItem(item.id, {
      text: title.trim(),
      description: description.trim() || null,
    });
    onChange();
    onClose();
  };

  return (
    <div className="linear-modal-overlay" onClick={onClose}>
      <div
        className="linear-modal task-detail"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="linear-modal-title">
          {item.kind === "note" ? "note" : "task"}
          {item.status === "closed" && " · done"}
          {isLinear && (
            <a
              className="chip linear-chip"
              href={item.source_deeplink ?? undefined}
              target="_blank"
              rel="noreferrer"
              title="open in Linear"
            >
              <b>L</b>
              {item.linear_identifier}
            </a>
          )}
        </div>
        {error && <div className="linear-modal-error">{error}</div>}
        {isLinear ? (
          <>
            <div className="linear-modal-task">{item.text}</div>
            {item.description ? (
              <div className="task-detail-desc">{item.description}</div>
            ) : (
              <div className="quiet">no description</div>
            )}
            <div className="quiet">synced from Linear — edit title/description there.</div>
            {item.status !== "closed" && (
              <div className="task-detail-states">
                <span className="quiet">state:</span>
                {(
                  [
                    ["backlog", "backlog"],
                    ["unstarted", "todo"],
                    ["started", "in progress"],
                  ] as const
                ).map(([type, label]) => {
                  const current = item.linear_state_type === type;
                  return (
                    <button
                      key={type}
                      className={`tog ${current ? "on" : ""}`}
                      disabled={busy || current}
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          await api.setLinearState(item.id, type);
                          onChange();
                        } catch (e) {
                          setError(String(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {current ? item.linear_state ?? label : label}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <label>
              title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
            </label>
            <label>
              description
              <textarea
                rows={5}
                value={description}
                placeholder="add more detail…"
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && (e.metaKey || e.ctrlKey) && save()
                }
              />
            </label>
          </>
        )}
        <div className="task-detail-meta">
          {item.kind !== "note" && (
            <span className={`prio-chip prio-${item.priority}`}>
              P{item.priority}
            </span>
          )}
          {item.tag === "#c!" && <span className="due-chip overdue">urgent</span>}
          {item.linear_team && <span className="tag-chip">{item.linear_team}</span>}
          {item.linear_state && <span className="tag-chip">{item.linear_state}</span>}
          {item.assignee && <span className="tag-chip">@{item.assignee}</span>}
          {item.due_date && (
            <span className="due-chip later">due {shortDate(item.due_date)}</span>
          )}
          {item.scheduled_date && (
            <span className="due-chip later">
              on calendar {shortDate(item.scheduled_date)}
              {item.scheduled_time ? ` ${fmt12(item.scheduled_time)}` : ""}
            </span>
          )}
          {item.tags.map((t) => (
            <span key={t} className="tag-chip">
              #{t}
            </span>
          ))}
        </div>
        <div className="quiet">
          captured {shortDate(item.captured_date)}
          {item.closed_date && <> · completed {doneLabel(item.closed_date)}</>}
        </div>
        <div className="linear-modal-actions">
          <button onClick={onClose}>close</button>
          {!isLinear && (
            <button className="primary" disabled={!dirty || busy} onClick={save}>
              save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LinearSendModal: create a Linear issue from a draft — either        */
/* converting an existing task (itemId set) or a brand-new issue from  */
/* the composer, e.g. for a teammate. Title + due date carry over;     */
/* team/assignee/priority/description are the Linear-side fields.      */
/* ------------------------------------------------------------------ */

const LINEAR_PRIORITIES: [number, string][] = [
  [1, "urgent"],
  [2, "high"],
  [3, "medium"],
  [4, "low"],
  [0, "none"],
];

type LinearDraft = {
  text: string;
  description: string | null;
  due_date: string | null;
  priority: Priority;
};

function LinearSendModal({
  draft,
  itemId,
  onDone,
  onCancel,
}: {
  draft: LinearDraft;
  itemId?: number; // set = convert this existing task
  onDone: () => void;
  onCancel: () => void;
}) {
  const [teams, setTeams] = useState<LinearTeam[] | null>(null);
  const [teamId, setTeamId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  // Default from the local P1-3: P1→high, P2→medium, P3→low.
  const [priority, setPriority] = useState(draft.priority + 1);
  const [description, setDescription] = useState(draft.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(onCancel);

  useEffect(() => {
    api
      .linearTeams()
      .then((t) => {
        setTeams(t);
        if (t[0]) setTeamId(t[0].id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const team = teams?.find((t) => t.id === teamId);
  const submit = async () => {
    if (!teamId || busy) return;
    setBusy(true);
    try {
      if (itemId != null) {
        await api.sendToLinear(itemId, {
          team_id: teamId,
          assignee_id: assigneeId || null,
          priority,
          description: description || null,
        });
      } else {
        await api.newLinearIssue({
          team_id: teamId,
          title: draft.text,
          description: description || null,
          assignee_id: assigneeId || null,
          priority,
          due_date: draft.due_date,
        });
      }
      onDone();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="linear-modal-overlay" onClick={onCancel}>
      <div
        className="linear-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="linear-modal-title">
          {itemId != null ? "send to linear" : "new linear issue"}
        </div>
        <div className="linear-modal-task">{draft.text}</div>
        {error && <div className="linear-modal-error">{error}</div>}
        <label>
          team
          <select
            value={teamId}
            onChange={(e) => {
              setTeamId(e.target.value);
              setAssigneeId("");
            }}
          >
            {(teams ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.key})
              </option>
            ))}
          </select>
        </label>
        <label>
          assignee
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">unassigned</option>
            {(team?.members ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          priority
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            {LINEAR_PRIORITIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          description
          <textarea
            rows={3}
            value={description}
            placeholder="optional details for the issue…"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {draft.due_date && (
          <div className="quiet">due date ({shortDate(draft.due_date)}) carries over</div>
        )}
        <div className="linear-modal-actions">
          <button onClick={onCancel}>cancel</button>
          <button className="primary" disabled={!teamId || busy} onClick={submit}>
            {busy ? "sending…" : "create issue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SubComposer({
  parentId,
  depth,
  onDone,
  onCancel,
}: {
  parentId: number;
  depth: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const submit = async () => {
    if (!text.trim()) return;
    await api.addItem({ text: text.trim(), parent_id: parentId });
    onDone();
  };
  return (
    <div className="task-row nested sub-composer" style={{ paddingLeft: 12 + depth * 18 }}>
      <span className="tree-toggle empty" />
      <input
        className="task-row-input"
        autoFocus
        value={text}
        placeholder="subtask — enter to add"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => {
          if (!text.trim()) onCancel();
        }}
      />
      <button className="tb-add" onClick={submit} disabled={!text.trim()}>
        add
      </button>
    </div>
  );
}

function Composer({
  settings,
  onCreated,
}: {
  settings: Settings;
  onCreated: () => void;
}) {
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>(2);
  const [tagInput, setTagInput] = useState("");
  const [assignee, setAssignee] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [linearOpen, setLinearOpen] = useState(false);

  const clear = () => {
    setText("");
    setDescription("");
    setDueDate("");
    setPriority(2);
    setTagInput("");
    setAssignee("");
    setUrgent(false);
  };

  const submit = async () => {
    if (!text.trim()) return;
    const tags = tagInput
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    // Convenience: "prep deck @sam" fills assignee if the field is empty.
    const fromText = text.match(/@([\w.-]+)/);
    const who = assignee || fromText?.[1] || null;
    await api.addItem({
      text: text.trim(),
      tag: urgent ? settings.tags.urgent : settings.tags.normal,
      due_date: dueDate || null,
      priority,
      tags,
      assignee: who,
      description: description || null,
    });
    clear();
    onCreated();
  };

  return (
    <div className="tb-composer">
      <div className="tb-composer-row">
        <input
          className="tb-composer-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="task title"
        />
      </div>
      <textarea
        className="tb-composer-desc"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submit()}
        placeholder="description (optional) — ⌘enter to add"
      />
      <div className="tb-composer-row">
        <PrioBars
          priority={priority}
          onClick={() => setPriority(((priority % 3) + 1) as Priority)}
        />
        <input
          type="date"
          className="tb-composer-date"
          title="due date (deadline)"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <input
          className="tb-composer-who"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="@person"
          title="assign to someone"
        />
        <input
          className="tb-composer-tags"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="tags"
        />
        <button
          className={`urgent-toggle ${urgent ? "on" : ""}`}
          title="urgent"
          onClick={() => setUrgent(!urgent)}
        >
          !
        </button>
        <span className="tb-composer-spacer" />
        {settings.sources.linear && (
          <button
            className="tb-add"
            title="create this as a Linear issue (pick team + assignee)"
            onClick={() => setLinearOpen(true)}
            disabled={!text.trim()}
          >
            linear
          </button>
        )}
        <button className="tb-add" onClick={submit} disabled={!text.trim()}>
          add
        </button>
      </div>
      {linearOpen && (
        <LinearSendModal
          draft={{
            text: text.trim(),
            description: description || null,
            due_date: dueDate || null,
            priority,
          }}
          onDone={() => {
            setLinearOpen(false);
            clear();
            onCreated();
          }}
          onCancel={() => setLinearOpen(false)}
        />
      )}
    </div>
  );
}
