"use client";

import { useMemo, useState } from "react";
import { downloadTargetsCsv } from "@/lib/csv";
import { downloadBlob } from "@/lib/pdf";
import { STATUSES } from "@/lib/targets";
import type { Target, TargetStatus } from "@/lib/types";

const PRESENCE_LABEL: Record<Target["business"]["presence"], string> = {
  none: "No website",
  "social-only": "Social only",
  site: "Has a site",
};

const PRESENCE_CLASS: Record<Target["business"]["presence"], string> = {
  none: "badge none",
  "social-only": "badge social",
  site: "badge site",
};

export interface TargetsSheetProps {
  targets: Target[];
  senderName: string;
  onSenderName: (value: string) => void;
  onUpdate: (id: string, patch: Partial<Omit<Target, "business">>) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onOpen: (target: Target) => void;
  onClose: () => void;
}

export default function TargetsSheet({
  targets,
  senderName,
  onSenderName,
  onUpdate,
  onRemove,
  onClear,
  onOpen,
  onClose,
}: TargetsSheetProps) {
  const [statusFilter, setStatusFilter] = useState<TargetStatus | "all">("all");
  const [progress, setProgress] = useState<number | null>(null);

  const visible = useMemo(
    () =>
      statusFilter === "all"
        ? targets
        : targets.filter((target) => target.status === statusFilter),
    [targets, statusFilter],
  );

  const summary = useMemo(() => {
    const noWebsite = targets.filter((t) => t.business.presence === "none").length;
    const socialOnly = targets.filter((t) => t.business.presence === "social-only").length;
    const reachable = targets.filter((t) => t.business.phone).length;
    const won = targets.filter((t) => t.status === "won").length;
    return { noWebsite, socialOnly, reachable, won };
  }, [targets]);

  const buildPack = async () => {
    if (!visible.length) return;
    setProgress(0);
    try {
      const { buildProspectPdf } = await import("@/lib/pdf");
      const blob = await buildProspectPdf(visible, {
        senderName,
        onProgress: setProgress,
      });
      downloadBlob(blob, `finder-targets-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Target list">
      <div className="sheet">
        <header className="sheet-head">
          <div>
            <h2>Stores we are targeting</h2>
            <p className="muted-note">
              {targets.length} saved · {summary.noWebsite} with no website ·{" "}
              {summary.socialOnly} social only · {summary.reachable} reachable by phone
              {summary.won > 0 && ` · ${summary.won} won`}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="sheet-toolbar">
          <label className="field-row">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as TargetStatus | "all")
              }
            >
              <option value="all">All</option>
              {STATUSES.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field-row">
            <span>Sign off as</span>
            <input
              value={senderName}
              placeholder="your name"
              onChange={(event) => onSenderName(event.target.value)}
            />
          </label>

          <span style={{ flex: 1 }} />

          <button
            type="button"
            className="button-ghost"
            disabled={!visible.length}
            onClick={() =>
              downloadTargetsCsv(
                visible,
                `finder-targets-${new Date().toISOString().slice(0, 10)}.csv`,
              )
            }
          >
            Export CSV
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={!visible.length || progress !== null}
            onClick={buildPack}
          >
            {progress === null
              ? `Download PDF pack (${visible.length})`
              : `Building… ${Math.round(progress * 100)}%`}
          </button>
          <button
            type="button"
            className="link-button"
            disabled={!targets.length}
            onClick={() => {
              if (window.confirm("Remove every business from the target list?")) onClear();
            }}
          >
            Clear all
          </button>
        </div>

        <div className="sheet-scroll">
          {visible.length === 0 ? (
            <div className="empty">
              <strong>Nothing in the list yet</strong>
              Add businesses from the results or the map, and they will show up here with
              their phone numbers, ready to work through.
            </div>
          ) : (
            <table className="sheet-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>#</th>
                  <th style={{ minWidth: 170 }}>Business</th>
                  <th style={{ minWidth: 105 }}>Presence</th>
                  <th style={{ minWidth: 140 }}>Phone</th>
                  <th style={{ minWidth: 175 }}>Address</th>
                  <th style={{ minWidth: 105 }}>Status</th>
                  <th style={{ minWidth: 190 }}>Notes</th>
                  <th style={{ width: 52 }}>Score</th>
                  <th style={{ width: 125 }} />
                </tr>
              </thead>
              <tbody>
                {visible.map((target, index) => (
                  <tr key={target.business.id}>
                    <td className="row-number">{index + 1}</td>
                    <td>
                      <button
                        type="button"
                        className="cell-link"
                        onClick={() => onOpen(target)}
                      >
                        {target.business.name}
                      </button>
                      <div className="muted-note">{target.business.category}</div>
                    </td>
                    <td>
                      <span className={PRESENCE_CLASS[target.business.presence]}>
                        {PRESENCE_LABEL[target.business.presence]}
                      </span>
                    </td>
                    <td>
                      {target.business.phone ? (
                        <a href={`tel:${target.business.phone.replace(/\s+/g, "")}`}>
                          {target.business.phone}
                        </a>
                      ) : (
                        <span className="muted-note">—</span>
                      )}
                    </td>
                    <td className="wrap">{target.business.address ?? "—"}</td>
                    <td>
                      <select
                        value={target.status}
                        aria-label={`Status for ${target.business.name}`}
                        onChange={(event) =>
                          onUpdate(target.business.id, {
                            status: event.target.value as TargetStatus,
                          })
                        }
                      >
                        {STATUSES.map((status) => (
                          <option key={status.id} value={status.id}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={target.notes}
                        placeholder="Add a note…"
                        aria-label={`Notes for ${target.business.name}`}
                        onChange={(event) =>
                          onUpdate(target.business.id, { notes: event.target.value })
                        }
                      />
                    </td>
                    <td className="row-number">{target.business.leadScore}</td>
                    <td className="row-actions">
                      <button type="button" onClick={() => onOpen(target)}>
                        Brief
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(target.business.id)}
                        aria-label={`Remove ${target.business.name}`}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
