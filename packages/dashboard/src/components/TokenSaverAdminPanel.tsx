import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  GROUPY_TOKEN_SAVER_LABEL,
  CLASSIC_TOKEN_SAVER_LABEL,
  TOKEN_SAVER_INTRO,
  TOKEN_SAVER_PIPELINE,
  getTokenSaverFeature,
  intensityNeedsConfirm,
  type TokenSaverFeatureId,
} from "@/lib/token-saver-copy";

export type TsAdminState = {
  tokenSaverAntiWasteEnabled: boolean;
  tokenSaverAntiWasteMode: string;
  tokenSaverAntiWasteLevel: string;
  tokenSaverAntiWasteCustom: string;
  tokenSaverGroupyCompactEnabled: boolean;
  tokenSaverGroupyCompactMode: string;
  tokenSaverGroupyCompactLevel: string;
  tokenSaverGroupyCompactCustom: string;
  tokenSaverBatchEnabled: boolean;
  tokenSaverBatchMode: string;
  tokenSaverBatchLevel: string;
  tokenSaverBatchCustom: string;
  tokenSaverStreamToNonstreamEnabled: boolean;
  tokenSaverNonstreamToStreamEnabled: boolean;
  tokenSaverRtkEnabled: boolean;
  tokenSaverRtkMode: string;
  tokenSaverRtkLevel: string;
  tokenSaverRtkCustom: string;
  tokenSaverRtkMaxChars: number;
  tokenSaverHeadroomEnabled: boolean;
  tokenSaverHeadroomUrl: string;
  tokenSaverHeadroomMode: string;
  tokenSaverHeadroomLevel: string;
  tokenSaverHeadroomCustom: string;
  tokenSaverCavemanEnabled: boolean;
  tokenSaverCavemanMode: string;
  tokenSaverCavemanLevel: number;
  tokenSaverCavemanCustom: string;
  tokenSaverPonytailEnabled: boolean;
  tokenSaverPonytailMode: string;
  tokenSaverPonytailLevel: string;
  tokenSaverPonytailCustom: string;
};

function parseCustom(raw: string): Record<string, unknown> {
  try {
    const j = JSON.parse(raw || "{}");
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

function FeatureHelp({ id }: { id: TokenSaverFeatureId }) {
  const f = getTokenSaverFeature(id);
  return (
    <div className="pr-4 space-y-1 flex-1 min-w-0">
      <Label className="font-medium">{f.label}</Label>
      <p className="text-xs text-foreground/80">
        <span className="font-medium">Effect: </span>
        {f.effectShort}
      </p>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{f.effectLong}</p>
      <p className="text-[11px] text-amber-600/90 dark:text-amber-400/80">
        <span className="font-medium">Risk: </span>
        {f.riskShort} — {f.riskLong}
      </p>
      <p className="text-[10px] text-muted-foreground">{f.intensityHint}</p>
      <p className="text-[10px] text-muted-foreground/80">Safe: {f.safeZone}</p>
    </div>
  );
}

function IntensityRow({
  feature,
  mode,
  setMode,
  preset,
  setPreset,
  presetOptions,
  custom,
  setCustom,
  customFields,
}: {
  feature: TokenSaverFeatureId;
  mode: string;
  setMode: (m: string) => void;
  preset: string;
  setPreset: (p: string) => void;
  presetOptions: { value: string; label: string }[];
  custom: string;
  setCustom: (c: string) => void;
  customFields: { key: string; label: string; min?: number; max?: number }[];
}) {
  const obj = parseCustom(custom);
  const warn = intensityNeedsConfirm(
    feature,
    mode === "custom" ? "custom" : "preset",
    preset,
    obj,
  );
  return (
    <div className="ml-2 pl-3 border-l border-border/40 space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <Label className="text-xs">Intensity</Label>
        <select
          value={mode === "custom" ? "custom" : "preset"}
          onChange={(e) => setMode(e.target.value)}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
        >
          <option value="preset">Preset</option>
          <option value="custom">Custom</option>
        </select>
        {mode !== "custom" ? (
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs max-w-xs"
          >
            {presetOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex flex-wrap gap-2">
            {customFields.map((f) => (
              <div key={f.key} className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">{f.label}</span>
                <Input
                  type="number"
                  min={f.min}
                  max={f.max}
                  className="h-8 w-20 text-xs"
                  value={Number(obj[f.key] ?? "") || ""}
                  onChange={(e) => {
                    const next = { ...obj, [f.key]: Number(e.target.value) };
                    setCustom(JSON.stringify(next));
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      {warn && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded px-2 py-1">
          Warning: intensity is aggressive — agent loops / partial re-reads may be disrupted. Save only if intentional.
        </p>
      )}
    </div>
  );
}

type Props = {
  state: TsAdminState;
  set: <K extends keyof TsAdminState>(key: K, value: TsAdminState[K]) => void;
};

export function TokenSaverAdminPanel({ state, set }: Props) {
  const aggressiveBanner = useMemo(() => {
    const checks: string[] = [];
    if (
      state.tokenSaverAntiWasteEnabled &&
      intensityNeedsConfirm(
        "antiWaste",
        state.tokenSaverAntiWasteMode === "custom" ? "custom" : "preset",
        state.tokenSaverAntiWasteLevel,
        parseCustom(state.tokenSaverAntiWasteCustom),
      )
    )
      checks.push("Anti-Waste");
    if (
      state.tokenSaverGroupyCompactEnabled &&
      intensityNeedsConfirm(
        "groupyCompact",
        state.tokenSaverGroupyCompactMode === "custom" ? "custom" : "preset",
        state.tokenSaverGroupyCompactLevel,
        parseCustom(state.tokenSaverGroupyCompactCustom),
      )
    )
      checks.push("Groupy Compact");
    if (
      state.tokenSaverBatchEnabled &&
      intensityNeedsConfirm(
        "batch",
        state.tokenSaverBatchMode === "custom" ? "custom" : "preset",
        state.tokenSaverBatchLevel,
        parseCustom(state.tokenSaverBatchCustom),
      )
    )
      checks.push("Soft Batch");
    if (
      state.tokenSaverRtkEnabled &&
      intensityNeedsConfirm(
        "rtk",
        state.tokenSaverRtkMode === "custom" ? "custom" : "preset",
        state.tokenSaverRtkLevel,
        parseCustom(state.tokenSaverRtkCustom),
      )
    )
      checks.push("RTK");
    return checks;
  }, [state]);

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>{TOKEN_SAVER_INTRO.long}</p>
        <p className="text-xs">
          Pipeline: <strong className="text-foreground">{TOKEN_SAVER_PIPELINE}</strong>
        </p>
      </div>
      {aggressiveBanner.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Aggressive intensity active: {aggressiveBanner.join(", ")}. Users may see early short-circuits or heavier stubs.
        </div>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight">{GROUPY_TOKEN_SAVER_LABEL}</h3>
        <p className="text-[11px] text-muted-foreground">Default ON — Groupy-owned savings + IDE loop guard.</p>

        <div className="flex items-start justify-between gap-3 p-3 border border-border/50 rounded-lg">
          <FeatureHelp id="antiWaste" />
          <Switch
            checked={state.tokenSaverAntiWasteEnabled}
            onCheckedChange={(v) => set("tokenSaverAntiWasteEnabled", v)}
          />
        </div>
        {state.tokenSaverAntiWasteEnabled && (
          <IntensityRow
            feature="antiWaste"
            mode={state.tokenSaverAntiWasteMode}
            setMode={(m) => set("tokenSaverAntiWasteMode", m)}
            preset={state.tokenSaverAntiWasteLevel}
            setPreset={(p) => set("tokenSaverAntiWasteLevel", p)}
            presetOptions={[
              { value: "lite", label: "lite — 3/5/12 (longgar)" },
              { value: "balanced", label: "balanced — 3/4/8 (default)" },
              { value: "aggressive", label: "aggressive — 2/3/5" },
            ]}
            custom={state.tokenSaverAntiWasteCustom}
            setCustom={(c) => set("tokenSaverAntiWasteCustom", c)}
            customFields={[
              { key: "nudgeAt", label: "nudge", min: 1, max: 20 },
              { key: "dedupeAt", label: "dedupe", min: 1, max: 30 },
              { key: "shortCircuitAt", label: "shortCircuit", min: 2, max: 50 },
            ]}
          />
        )}

        <div className="flex items-start justify-between gap-3 p-3 border border-border/50 rounded-lg">
          <FeatureHelp id="groupyCompact" />
          <Switch
            checked={state.tokenSaverGroupyCompactEnabled}
            onCheckedChange={(v) => set("tokenSaverGroupyCompactEnabled", v)}
          />
        </div>
        {state.tokenSaverGroupyCompactEnabled && (
          <IntensityRow
            feature="groupyCompact"
            mode={state.tokenSaverGroupyCompactMode}
            setMode={(m) => set("tokenSaverGroupyCompactMode", m)}
            preset={state.tokenSaverGroupyCompactLevel}
            setPreset={(p) => set("tokenSaverGroupyCompactLevel", p)}
            presetOptions={[
              { value: "lite", label: "lite — keep 4 / stub ≥4k" },
              { value: "balanced", label: "balanced — keep 3 / stub ≥1.5k" },
              { value: "aggressive", label: "aggressive — keep 2 / stub ≥400" },
            ]}
            custom={state.tokenSaverGroupyCompactCustom}
            setCustom={(c) => set("tokenSaverGroupyCompactCustom", c)}
            customFields={[
              { key: "keepLastN", label: "keepLastN", min: 1, max: 10 },
              { key: "stubMinChars", label: "stubMinChars", min: 200, max: 20000 },
            ]}
          />
        )}

        <div className="flex items-start justify-between gap-3 p-3 border border-border/50 rounded-lg">
          <FeatureHelp id="batch" />
          <Switch
            checked={state.tokenSaverBatchEnabled}
            onCheckedChange={(v) => set("tokenSaverBatchEnabled", v)}
          />
        </div>
        {state.tokenSaverBatchEnabled && (
          <IntensityRow
            feature="batch"
            mode={state.tokenSaverBatchMode}
            setMode={(m) => set("tokenSaverBatchMode", m)}
            preset={state.tokenSaverBatchLevel}
            setPreset={(p) => set("tokenSaverBatchLevel", p)}
            presetOptions={[
              { value: "lite", label: "lite — soft nudge" },
              { value: "balanced", label: "balanced — standard" },
              { value: "aggressive", label: "aggressive — strong nudge" },
            ]}
            custom={state.tokenSaverBatchCustom}
            setCustom={(c) => set("tokenSaverBatchCustom", c)}
            customFields={[{ key: "strength", label: "strength", min: 1, max: 5 }]}
          />
        )}

        <div className="flex items-start justify-between gap-3 p-3 border border-border/50 rounded-lg">
          <FeatureHelp id="streamToNonstream" />
          <Switch
            checked={state.tokenSaverStreamToNonstreamEnabled}
            onCheckedChange={(v) => set("tokenSaverStreamToNonstreamEnabled", v)}
          />
        </div>

        <div className="flex items-start justify-between gap-3 p-3 border border-border/50 rounded-lg">
          <FeatureHelp id="nonstreamToStream" />
          <Switch
            checked={state.tokenSaverNonstreamToStreamEnabled}
            onCheckedChange={(v) => set("tokenSaverNonstreamToStreamEnabled", v)}
          />
        </div>
        {state.tokenSaverStreamToNonstreamEnabled && state.tokenSaverNonstreamToStreamEnabled && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Kedua arah Stream Translate aktif: request streaming dipaksa non-stream ke upstream, dan
            request non-stream dipaksa streaming. Pastikan ini memang disengaja — untuk hemat biaya
            (mis. pajak stream amanai) cukup nyalakan Stream → Non-stream saja.
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight">{CLASSIC_TOKEN_SAVER_LABEL}</h3>
        <p className="text-[11px] text-muted-foreground">RTK default ON; Headroom/Caveman/Ponytail default OFF.</p>

        <div className="flex items-start justify-between gap-3 p-3 border border-border/50 rounded-lg">
          <FeatureHelp id="rtk" />
          <Switch
            checked={state.tokenSaverRtkEnabled}
            onCheckedChange={(v) => set("tokenSaverRtkEnabled", v)}
          />
        </div>
        {state.tokenSaverRtkEnabled && (
          <>
            <IntensityRow
              feature="rtk"
              mode={state.tokenSaverRtkMode}
              setMode={(m) => set("tokenSaverRtkMode", m)}
              preset={state.tokenSaverRtkLevel}
              setPreset={(p) => set("tokenSaverRtkLevel", p)}
              presetOptions={[
                { value: "lite", label: "lite — 4000 chars" },
                { value: "balanced", label: "balanced — 2000 chars" },
                { value: "aggressive", label: "aggressive — 800 chars" },
              ]}
              custom={state.tokenSaverRtkCustom}
              setCustom={(c) => {
                set("tokenSaverRtkCustom", c);
                const m = Number(parseCustom(c).maxChars);
                if (m > 0) set("tokenSaverRtkMaxChars", m);
              }}
              customFields={[{ key: "maxChars", label: "maxChars", min: 200, max: 50000 }]}
            />
            {state.tokenSaverRtkMode !== "custom" && (
              <div className="ml-2 pl-3">
                <Label className="text-xs">Legacy max chars (balanced override)</Label>
                <Input
                  type="number"
                  className="mt-1 max-w-xs h-8 text-xs"
                  value={state.tokenSaverRtkMaxChars}
                  onChange={(e) => set("tokenSaverRtkMaxChars", parseInt(e.target.value) || 2000)}
                />
              </div>
            )}
          </>
        )}

        <div className="flex items-start justify-between gap-3 p-3 border border-border/50 rounded-lg">
          <FeatureHelp id="headroom" />
          <Switch
            checked={state.tokenSaverHeadroomEnabled}
            onCheckedChange={(v) => set("tokenSaverHeadroomEnabled", v)}
          />
        </div>
        {state.tokenSaverHeadroomEnabled && (
          <>
            <div className="ml-2 pl-3">
              <Label className="text-xs">Headroom URL</Label>
              <Input
                className="mt-1 text-xs"
                value={state.tokenSaverHeadroomUrl}
                onChange={(e) => set("tokenSaverHeadroomUrl", e.target.value)}
                placeholder="https://headroom.example/v1/compress"
              />
            </div>
            <IntensityRow
              feature="headroom"
              mode={state.tokenSaverHeadroomMode}
              setMode={(m) => set("tokenSaverHeadroomMode", m)}
              preset={state.tokenSaverHeadroomLevel}
              setPreset={(p) => set("tokenSaverHeadroomLevel", p)}
              presetOptions={[
                { value: "lite", label: "lite — timeout 5s" },
                { value: "balanced", label: "balanced — 3s" },
                { value: "aggressive", label: "aggressive — 1s" },
              ]}
              custom={state.tokenSaverHeadroomCustom}
              setCustom={(c) => set("tokenSaverHeadroomCustom", c)}
              customFields={[{ key: "timeoutMs", label: "timeoutMs", min: 500, max: 10000 }]}
            />
          </>
        )}

        <div className="flex items-start justify-between gap-3 p-3 border border-border/50 rounded-lg">
          <FeatureHelp id="caveman" />
          <Switch
            checked={state.tokenSaverCavemanEnabled}
            onCheckedChange={(v) => set("tokenSaverCavemanEnabled", v)}
          />
        </div>
        {state.tokenSaverCavemanEnabled && (
          <IntensityRow
            feature="caveman"
            mode={state.tokenSaverCavemanMode}
            setMode={(m) => set("tokenSaverCavemanMode", m)}
            preset={String(state.tokenSaverCavemanLevel)}
            setPreset={(p) => set("tokenSaverCavemanLevel", Math.max(1, Math.min(5, Number(p) || 2)))}
            presetOptions={[1, 2, 3, 4, 5].map((n) => ({
              value: String(n),
              label: `level ${n}${n >= 4 ? " (agresif)" : ""}`,
            }))}
            custom={state.tokenSaverCavemanCustom}
            setCustom={(c) => set("tokenSaverCavemanCustom", c)}
            customFields={[{ key: "level", label: "level", min: 1, max: 5 }]}
          />
        )}

        <div className="flex items-start justify-between gap-3 p-3 border border-border/50 rounded-lg">
          <FeatureHelp id="ponytail" />
          <Switch
            checked={state.tokenSaverPonytailEnabled}
            onCheckedChange={(v) => set("tokenSaverPonytailEnabled", v)}
          />
        </div>
        {state.tokenSaverPonytailEnabled && (
          <IntensityRow
            feature="ponytail"
            mode={state.tokenSaverPonytailMode}
            setMode={(m) => set("tokenSaverPonytailMode", m)}
            preset={state.tokenSaverPonytailLevel}
            setPreset={(p) => set("tokenSaverPonytailLevel", p)}
            presetOptions={[
              { value: "lite", label: "lite" },
              { value: "full", label: "full" },
              { value: "ultra", label: "ultra (agresif)" },
            ]}
            custom={state.tokenSaverPonytailCustom}
            setCustom={(c) => set("tokenSaverPonytailCustom", c)}
            customFields={[{ key: "strength", label: "strength 1–3", min: 1, max: 3 }]}
          />
        )}
      </section>
    </div>
  );
}

