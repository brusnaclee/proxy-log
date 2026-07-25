import { useEffect, useState } from "react";
import { keys } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNotify } from "@/components/Notify";
import { CalendarClock, RotateCcw, Save, Trash2 } from "lucide-react";

type Props = {
  keyId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
};

export function DayOverrideDialog({ keyId, open, onOpenChange, onChanged }: Props) {
  const notify = useNotify();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [dayWib, setDayWib] = useState("");
  const [extraDailyInput, setExtraDailyInput] = useState(0);
  const [extraDailyOutput, setExtraDailyOutput] = useState(0);
  const [extraDailyTotal, setExtraDailyTotal] = useState(0);
  const [extraPromptLimit, setExtraPromptLimit] = useState(0);
  const [extraRateLimit, setExtraRateLimit] = useState(0);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await keys.getDayOverride(keyId);
        if (cancelled) return;
        setDayWib(res.dayWib || res.todayWib);
        const o = res.override;
        setExtraDailyInput(o?.extraDailyInput || 0);
        setExtraDailyOutput(o?.extraDailyOutput || 0);
        setExtraDailyTotal(o?.extraDailyTotal || 0);
        setExtraPromptLimit(o?.extraPromptLimit || 0);
        setExtraRateLimit(o?.extraRateLimit || 0);
        setNote(o?.note || "");
      } catch (e: any) {
        notify.error(e?.message || "Failed to load day override");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, keyId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await keys.setDayOverride(keyId, {
        dayWib,
        extraDailyInput,
        extraDailyOutput,
        extraDailyTotal,
        extraPromptLimit,
        extraRateLimit,
        note,
      });
      notify.success(
        res.cleared
          ? `Day override cleared for ${res.dayWib}`
          : `Day override saved for ${res.dayWib} (expires next WIB midnight)`,
      );
      onChanged?.();
      onOpenChange(false);
    } catch (e: any) {
      notify.error(e?.message || "Failed to save day override");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    const ok = await notify.confirm({
      title: "Clear day override?",
      message: `Remove all temporary bonuses for ${dayWib || "today"} WIB.`,
      confirmLabel: "Clear",
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await keys.clearDayOverride(keyId, dayWib || undefined);
      notify.success("Day override cleared");
      onChanged?.();
      onOpenChange(false);
    } catch (e: any) {
      notify.error(e?.message || "Failed to clear");
    } finally {
      setSaving(false);
    }
  };

  const handleResetToday = async () => {
    const ok = await notify.confirm({
      title: "Reset today's usage?",
      message:
        "Deletes all request logs since midnight WIB for this Discord account (all keys share one pool). Permanent limits are unchanged. This cannot be undone.",
      confirmLabel: "Reset usage",
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      const res = await keys.resetTodayUsage(keyId);
      notify.success(res.message || `Reset ${res.deletedRows} rows`);
      onChanged?.();
    } catch (e: any) {
      notify.error(e?.message || "Failed to reset usage");
    } finally {
      setResetting(false);
    }
  };

  const field = (
    label: string,
    hint: string,
    value: number,
    set: (n: number) => void,
  ) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <p className="text-[11px] text-muted-foreground mb-1">{hint}</p>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => set(Math.max(0, parseInt(e.target.value) || 0))}
        disabled={loading || saving}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Today override
          </DialogTitle>
          <DialogDescription>
            Additive bonuses for <strong>{dayWib || "today"}</strong> WIB only.
            They stack on top of existing key / global / add-on caps (only when that cap is already set)
            and expire at next midnight WIB. Leave 0 to skip a field.
            Use <strong>Reset today's usage</strong> to wipe today&apos;s logs for the whole Discord account pool.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {field(
            "Extra daily input tokens",
            "Added to today's input cap (ignored when add-on bypasses I/O)",
            extraDailyInput,
            setExtraDailyInput,
          )}
          {field(
            "Extra daily output tokens",
            "Added to today's output cap (ignored when add-on bypasses I/O)",
            extraDailyOutput,
            setExtraDailyOutput,
          )}
          {field(
            "Extra daily total tokens",
            "Added to today's total (in+out / pack) hard cap",
            extraDailyTotal,
            setExtraDailyTotal,
          )}
          {field(
            "Extra prompt limit",
            "Temporary boost on the sliding prompt window while this day is active",
            extraPromptLimit,
            setExtraPromptLimit,
          )}
          {field(
            "Extra API call limit",
            "Temporary boost on the sliding API-call (hop) window",
            extraRateLimit,
            setExtraRateLimit,
          )}
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. compensation for outage"
              disabled={loading || saving}
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={resetting || loading}
            onClick={() => void handleResetToday()}
            className="w-full sm:w-auto"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            {resetting ? "Resetting…" : "Reset today's usage"}
          </Button>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || loading}
              onClick={() => void handleClear()}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving || loading}
              onClick={() => void handleSave()}
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              {saving ? "Saving…" : "Save override"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
