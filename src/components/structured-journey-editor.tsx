"use client";
import { useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  journeyDefinitionSchema,
  type TestStep,
} from "../../packages/runner/src/schema";
import { type Journey, type Project, validPath } from "@/lib/model";
import { useWorkspace } from "@/lib/workspace-store";
import { Dialog } from "./ui";
import { errorMessage, useFeedback } from "./feedback";

type Draft = {
  action: string;
  type: string;
  locator: string;
  name: string;
  value: string;
  secret: boolean;
  expected: string;
  count: string;
  path: string;
  key: string;
  timeout: string;
  exact: boolean;
};
const fresh = (): Draft => ({
  action: "assertText",
  type: "role",
  locator: "heading",
  name: "",
  value: "",
  secret: false,
  expected: "",
  count: "1",
  path: "/",
  key: "Enter",
  timeout: "5000",
  exact: false,
});
function fromStep(s: TestStep): Draft {
  return {
    ...fresh(),
    action: s.action,
    timeout: String(s.timeoutMs),
    ...("locator" in s
      ? {
          type: s.locator.type,
          locator: s.locator.value,
          name: "name" in s.locator ? s.locator.name || "" : "",
        }
      : {}),
    ...("value" in s
      ? s.action === "fill"
        ? {
            value: "text" in s.value ? s.value.text : s.value.secret,
            secret: "secret" in s.value,
          }
        : { value: s.value }
      : {}),
    ...("expected" in s ? { expected: s.expected } : {}),
    ...("count" in s ? { count: String(s.count) } : {}),
    ...("path" in s ? { path: s.path } : {}),
    ...("key" in s ? { key: s.key } : {}),
    ...(s.action === "assertURL"
      ? { exact: s.match === "equals" }
      : "exact" in s
        ? { exact: s.exact }
        : {}),
  };
}
function toStep(d: Draft) {
  const base = { action: d.action, timeoutMs: Number(d.timeout) };
  if (d.action === "navigate") return { ...base, path: d.path };
  if (d.action === "assertURL")
    return {
      ...base,
      expected: d.expected,
      match: d.exact ? "equals" : "contains",
    };
  const locator = {
    type: d.type,
    value: d.locator,
    ...(d.type === "role" && d.name ? { name: d.name } : {}),
  };
  if (d.action === "fill")
    return {
      ...base,
      locator,
      value: d.secret ? { secret: d.value } : { text: d.value },
    };
  if (d.action === "press") return { ...base, locator, key: d.key };
  if (d.action === "selectOption") return { ...base, locator, value: d.value };
  if (d.action === "assertText")
    return { ...base, locator, expected: d.expected, exact: d.exact };
  if (d.action === "assertElementCount")
    return { ...base, locator, count: Number(d.count) };
  return { ...base, locator };
}
function sameOriginPath(value: string, target: string) {
  try {
    return (
      validPath(value) &&
      new URL(value, target).origin === new URL(target).origin
    );
  } catch {
    return false;
  }
}
export function StructuredJourneyEditor({
  project,
  journey,
  onClose,
  onSaved,
}: {
  project: Project;
  journey?: Journey;
  onClose: () => void;
  onSaved?: (journey: Journey) => void;
}) {
  const { actions } = useWorkspace();
  const notify = useFeedback();
  const [name, setName] = useState(journey?.name || "");
  const [path, setPath] = useState(journey?.path || "/");
  const [steps, setSteps] = useState<Draft[]>(
    journey?.definition?.steps.map(fromStep) || [fresh()],
  );
  const [timeout, setTimeout] = useState(
    String(journey?.definition?.timeoutMs || 60000),
  );
  const [enabled, setEnabled] = useState(journey?.enabled !== false);
  const [capture, setCapture] = useState(
    journey?.definition?.captureArtifacts || false,
  );
  const [advanced, setAdvanced] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  function patch(index: number, value: Partial<Draft>) {
    setSteps((old) =>
      old.map((s, i) => (i === index ? { ...s, ...value } : s)),
    );
  }
  function reorder(index: number, by: number) {
    setSteps((old) => {
      const next = [...old];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const validation: Record<string, string> = {};
    if (!name.trim()) validation.name = "Give this journey a name.";
    if (!sameOriginPath(path, project.url))
      validation.path = "Use a start path on the approved project origin.";
    steps.forEach((step, index) => {
      if (step.action === "navigate" && !sameOriginPath(step.path, project.url))
        validation[`step-${index}`] =
          "Navigation must stay on the approved project origin.";
    });
    const parsed = journeyDefinitionSchema.safeParse({
      version: 1,
      steps: steps.map(toStep),
      timeoutMs: Number(timeout),
      captureArtifacts: capture,
    });
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const key =
          issue.path[0] === "steps" && typeof issue.path[1] === "number"
            ? `step-${issue.path[1]}`
            : String(issue.path[0]);
        validation[key] ||= issue.message;
      }
    setErrors(validation);
    if (Object.keys(validation).length || !parsed.success) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await actions.saveJourney(
        {
          projectId: project.id,
          name: name.trim(),
          path: path.trim(),
          condition:
            journey?.condition ||
            `${parsed.data.steps.length} structured steps`,
          definition: parsed.data,
          enabled,
        },
        journey,
      );
      notify(
        journey
          ? "Journey updated."
          : "Journey saved. Ready to configure execution.",
      );
      if (onSaved) onSaved(saved);
      else onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <Dialog
      title={journey ? "Edit journey" : "Create a journey"}
      description="Define browser actions and assertions. No code is generated or interpreted."
      onClose={() => {
        if (!pending.current) onClose();
      }}
      wide
    >
      <form onSubmit={submit} noValidate>
        {journey && !journey.definition && (
          <p className="info-panel">
            This legacy journey needs structured steps. Its previous condition
            is kept as a note: {journey.condition}
          </p>
        )}
        <div className="field">
          <label htmlFor="journey-name">Journey name</label>
          <input
            id="journey-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoFocus
            aria-invalid={!!errors.name}
          />
          {errors.name && <p className="field-error">{errors.name}</p>}
        </div>
        <div className="field">
          <label htmlFor="journey-path">Start path or URL</label>
          <input
            id="journey-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            maxLength={500}
            aria-invalid={!!errors.path}
          />
          <p className="field-hint">Must stay on {project.url}</p>
          {errors.path && <p className="field-error">{errors.path}</p>}
        </div>
        <div className="section-heading">
          <h3>Browser steps</h3>
          <span className="muted">{steps.length} / 30</span>
        </div>
        {steps.map((s, i) => (
          <fieldset className="journey-step-editor" key={i}>
            <legend>Step {i + 1}</legend>
            <div className="journey-step-toolbar">
              <button
                type="button"
                className="icon-button"
                aria-label={`Move step ${i + 1} up`}
                disabled={i === 0}
                onClick={() => reorder(i, -1)}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Move step ${i + 1} down`}
                disabled={i === steps.length - 1}
                onClick={() => reorder(i, 1)}
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove step ${i + 1}`}
                disabled={steps.length === 1}
                onClick={() => setSteps(steps.filter((_, n) => n !== i))}
              >
                <Trash2 size={15} />
              </button>
            </div>
            <div className="journey-step-fields">
              <div className="field">
                <label htmlFor={`action-${i}`}>Action</label>
                <select
                  id={`action-${i}`}
                  value={s.action}
                  onChange={(e) =>
                    patch(i, {
                      action: e.target.value,
                      value: "",
                      secret: false,
                    })
                  }
                >
                  {Object.entries({
                    navigate: "Navigate",
                    click: "Click",
                    fill: "Fill field",
                    press: "Press key",
                    selectOption: "Select option",
                    assertVisible: "Assert visible",
                    assertText: "Assert text",
                    assertURL: "Assert URL",
                    assertElementCount: "Assert element count",
                  }).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {s.action !== "navigate" && s.action !== "assertURL" && (
                <>
                  <div className="field">
                    <label htmlFor={`locator-type-${i}`}>Find element by</label>
                    <select
                      id={`locator-type-${i}`}
                      value={s.type}
                      onChange={(e) =>
                        patch(i, {
                          type: e.target.value,
                          locator: e.target.value === "role" ? "heading" : "",
                        })
                      }
                    >
                      {[
                        "role",
                        "label",
                        "placeholder",
                        "testId",
                        "text",
                        ...(advanced || s.type === "css" ? ["css"] : []),
                      ].map((value) => (
                        <option key={value} value={value}>
                          {
                            (
                              {
                                role: "Role",
                                label: "Label",
                                placeholder: "Placeholder",
                                testId: "Test ID",
                                text: "Text",
                                css: "CSS selector (advanced)",
                              } as Record<string, string>
                            )[value]
                          }
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`locator-${i}`}>
                      {s.type === "role" ? "Role" : "Locator value"}
                    </label>
                    {s.type === "role" ? (
                      <select
                        id={`locator-${i}`}
                        value={s.locator}
                        onChange={(e) => patch(i, { locator: e.target.value })}
                      >
                        {[
                          "heading",
                          "button",
                          "link",
                          "textbox",
                          "checkbox",
                          "radio",
                          "combobox",
                          "option",
                          "dialog",
                          "alert",
                          "status",
                          "tab",
                          "menuitem",
                          "img",
                        ].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`locator-${i}`}
                        value={s.locator}
                        onChange={(e) => patch(i, { locator: e.target.value })}
                        maxLength={500}
                      />
                    )}
                  </div>
                  {s.type === "role" && (
                    <div className="field">
                      <label htmlFor={`locator-name-${i}`}>
                        Accessible name (optional)
                      </label>
                      <input
                        id={`locator-name-${i}`}
                        value={s.name}
                        onChange={(e) => patch(i, { name: e.target.value })}
                        maxLength={500}
                      />
                    </div>
                  )}
                </>
              )}
              {s.action === "navigate" && (
                <div className="field">
                  <label htmlFor={`path-${i}`}>Navigation path</label>
                  <input
                    id={`path-${i}`}
                    value={s.path}
                    onChange={(e) => patch(i, { path: e.target.value })}
                  />
                </div>
              )}
              {["fill", "selectOption"].includes(s.action) && (
                <div className="field">
                  <label htmlFor={`value-${i}`}>
                    {s.secret ? "Secret reference" : "Value"}
                  </label>
                  <input
                    id={`value-${i}`}
                    value={s.value}
                    onChange={(e) => patch(i, { value: e.target.value })}
                    placeholder={s.secret ? "FG_TEST_PASSWORD" : ""}
                  />
                  {s.action === "fill" && (
                    <label className="engine-check">
                      <input
                        type="checkbox"
                        checked={s.secret}
                        onChange={(e) =>
                          patch(i, { secret: e.target.checked, value: "" })
                        }
                      />
                      Use a protected runner secret
                    </label>
                  )}
                </div>
              )}
              {["assertText", "assertURL"].includes(s.action) && (
                <div className="field">
                  <label htmlFor={`expected-${i}`}>Expected value</label>
                  <input
                    id={`expected-${i}`}
                    value={s.expected}
                    onChange={(e) => patch(i, { expected: e.target.value })}
                    maxLength={500}
                  />
                  <label className="engine-check">
                    <input
                      type="checkbox"
                      checked={s.exact}
                      onChange={(e) => patch(i, { exact: e.target.checked })}
                    />
                    Exact match
                  </label>
                </div>
              )}
              {s.action === "assertElementCount" && (
                <div className="field">
                  <label htmlFor={`count-${i}`}>Expected count</label>
                  <input
                    id={`count-${i}`}
                    type="number"
                    min={0}
                    max={1000}
                    value={s.count}
                    onChange={(e) => patch(i, { count: e.target.value })}
                  />
                </div>
              )}
              {s.action === "press" && (
                <div className="field">
                  <label htmlFor={`key-${i}`}>Key</label>
                  <input
                    id={`key-${i}`}
                    value={s.key}
                    onChange={(e) => patch(i, { key: e.target.value })}
                    placeholder="Enter"
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor={`timeout-${i}`}>Step timeout (ms)</label>
                <input
                  id={`timeout-${i}`}
                  type="number"
                  min={500}
                  max={15000}
                  step={500}
                  value={s.timeout}
                  onChange={(e) => patch(i, { timeout: e.target.value })}
                />
              </div>
            </div>
            {errors[`step-${i}`] && (
              <p className="field-error" role="alert">
                {errors[`step-${i}`]}
              </p>
            )}
          </fieldset>
        ))}
        {errors.steps && (
          <p className="field-error" role="alert">
            {errors.steps}
          </p>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={steps.length >= 30}
          onClick={() => setSteps([...steps, fresh()])}
        >
          <Plus size={15} />
          Add step
        </button>
        <details className="technical-details">
          <summary>Execution settings</summary>
          <div className="field">
            <label htmlFor="overall-timeout">Overall timeout (ms)</label>
            <input
              id="overall-timeout"
              type="number"
              min={1000}
              max={120000}
              value={timeout}
              onChange={(e) => setTimeout(e.target.value)}
            />
            {errors.timeoutMs && (
              <p className="field-error">{errors.timeoutMs}</p>
            )}
          </div>
          <label className="engine-check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
          <label className="engine-check">
            <input
              type="checkbox"
              checked={advanced}
              onChange={(e) => setAdvanced(e.target.checked)}
            />
            Show advanced CSS locators
          </label>
          <label className="engine-check">
            <input
              type="checkbox"
              checked={capture}
              onChange={(e) => setCapture(e.target.checked)}
            />
            Capture private failure evidence
          </label>
          <p className="field-hint">
            Screenshots can contain application data. Capture is disabled for
            journeys using protected credentials. Traces retain action timings
            only.
          </p>
        </details>
        <p className="field-hint">
          At least one positive assertion is required. Passwords belong in
          FG_TEST_ repository secrets, never in text values.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : journey ? "Save changes" : "Create journey"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
