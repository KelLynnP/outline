import { useEffect, useState } from "react";
import type { CaughtItem, LinearTeam } from "@life-console/shared";
import { api } from "../api.js";

interface Props {
  item: CaughtItem;
  display: NoteTaskDisplay;
  onChanged: (item: CaughtItem) => void;
  onDisplayChange: (display: NoteTaskDisplay) => void;
  onClose: () => void;
}

export type NoteTaskDisplay = {
  linear: boolean;
  assignee: boolean;
  due: boolean;
  tags: boolean;
};

export function NoteTaskDetails({
  item,
  display: initialDisplay,
  onChanged,
  onDisplayChange,
  onClose,
}: Props) {
  const [title, setTitle] = useState(item.text);
  const [description, setDescription] = useState(item.description ?? "");
  const [dueDate, setDueDate] = useState(item.due_date ?? "");
  const [assignee, setAssignee] = useState(item.assignee ?? "");
  const [tags, setTags] = useState(item.tags.join(", "));
  const [teams, setTeams] = useState<LinearTeam[] | null>(null);
  const [teamId, setTeamId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [linearSetup, setLinearSetup] = useState(item.source === "linear");
  const [display, setDisplay] = useState(initialDisplay);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!linearSetup) return;
    api
      .linearTeams()
      .then((next) => {
        setTeams(next);
        const current = next.find((team) => team.key === item.linear_team);
        const selected = current ?? next[0];
        if (!selected) return;
        setTeamId(selected.id);
        setAssigneeId(
          selected.members.find((member) => member.name === item.assignee)?.id ?? "",
        );
      })
      .catch((cause) => setError(String(cause)));
  }, [linearSetup, item.id, item.linear_team, item.assignee]);

  const parsedTags = () =>
    tags
      .split(",")
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean);

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      let next: CaughtItem;
      if (item.source === "linear") {
        const team = teams?.find((candidate) => candidate.id === teamId);
        next = await api.updateLinearIssue(item.id, {
          title: title.trim(),
          description: description.trim() || null,
          due_date: dueDate || null,
          ...(team && team.key !== item.linear_team ? { team_id: team.id } : {}),
          ...(teams ? { assignee_id: assigneeId || null } : {}),
        });
        if (parsedTags().join(",") !== item.tags.join(",")) {
          next = await api.updateItem(item.id, { tags: parsedTags() });
        }
      } else {
        next = await api.updateItem(item.id, {
          text: title.trim(),
          description: description.trim() || null,
          due_date: dueDate || null,
          assignee: assignee.trim().replace(/^@+/, "") || null,
          tags: parsedTags(),
        });
      }
      onChanged(next);
      onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const makeLinear = async () => {
    if (!teamId || !title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.updateItem(item.id, {
        tags: parsedTags(),
        assignee: assignee.trim().replace(/^@+/, "") || null,
      });
      const next = await api.sendToLinear(item.id, {
        team_id: teamId,
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate || null,
        assignee_id: assigneeId || null,
      });
      onChanged(next);
      onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const selectedTeam = teams?.find((team) => team.id === teamId);

  return (
    <div
      className="note-task-details"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="note-task-details-head">
        <span>task</span>
        <button type="button" title="close" onClick={onClose}>×</button>
      </div>
      {error && <div className="note-task-error">{error}</div>}
      <input
        className="note-task-title-input"
        value={title}
        aria-label="Task title"
        onChange={(event) => setTitle(event.target.value)}
      />
      <textarea
        value={description}
        aria-label="Task notes"
        placeholder="notes"
        rows={2}
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className="note-task-fields">
        <label>
          due
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </label>
        {item.source === "linear" ? (
          <>
            <label>
              team
              <select
                value={teamId}
                disabled={!teams}
                onChange={(event) => {
                  setTeamId(event.target.value);
                  setAssigneeId("");
                }}
              >
                {teams?.map((team) => (
                  <option key={team.id} value={team.id}>{team.key}</option>
                ))}
              </select>
            </label>
            <label>
              assignee
              <select
                value={assigneeId}
                disabled={!selectedTeam}
                onChange={(event) => setAssigneeId(event.target.value)}
              >
                <option value="">unassigned</option>
                {selectedTeam?.members.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label>
            assignee
            <input
              value={assignee}
              placeholder="@person"
              onChange={(event) => setAssignee(event.target.value)}
            />
          </label>
        )}
        <label>
          tags
          <input
            value={tags}
            placeholder="project, area"
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
      </div>
      <div className="note-task-display">
        <span>show</span>
        {(
          [
            ["linear", "L / ID"],
            ["assignee", "assignee"],
            ["due", "due"],
            ["tags", "tags"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={display[key]}
              onChange={(event) => {
                const checked = event.target.checked;
                setDisplay((current) => {
                  const next = {
                    ...current,
                    [key]: checked,
                  };
                  onDisplayChange(next);
                  return next;
                });
              }}
            />
            {label}
          </label>
        ))}
      </div>
      {linearSetup && item.source !== "linear" && (
        <div className="note-task-linear">
          <label>
            Linear team
            <select
              value={teamId}
              disabled={!teams}
              onChange={(event) => {
                setTeamId(event.target.value);
                setAssigneeId("");
              }}
            >
              {teams?.map((team) => (
                <option key={team.id} value={team.id}>{team.key}</option>
              ))}
            </select>
          </label>
          <label>
            assignee
            <select
              value={assigneeId}
              disabled={!selectedTeam}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">unassigned</option>
              {selectedTeam?.members.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy || !teamId} onClick={makeLinear}>
            create in Linear
          </button>
        </div>
      )}
      <div className="note-task-actions">
        {item.source === "linear" && item.linear_identifier && (
          <a
            className="note-task-id"
            href={item.source_deeplink ?? undefined}
            target="_blank"
            rel="noreferrer"
          >
            {item.linear_identifier}
          </a>
        )}
        {item.source !== "linear" && !linearSetup && (
          <button type="button" onClick={() => setLinearSetup(true)}>L · make Linear</button>
        )}
        <button type="button" disabled={busy || !title.trim()} onClick={save}>
          {busy ? "saving…" : "save"}
        </button>
      </div>
    </div>
  );
}
