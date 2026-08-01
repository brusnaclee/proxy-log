/**
 * Serialize / parse Token Saver global + user intensity for admin/portal/Discord APIs.
 */

import {
  normalizeMode,
  normalizeLba,
  normalizePonytailLevel,
  stringifyCustom,
  type IntensityMode,
  type LiteBalancedAggressive,
} from "../utils/token-saver/intensity.js";

function asMode(v: unknown): IntensityMode {
  return normalizeMode(v);
}

function asLba(v: unknown, fb: LiteBalancedAggressive = "balanced"): LiteBalancedAggressive {
  return normalizeLba(v, fb);
}

function asCustom(v: unknown): string {
  if (v == null) return "{}";
  if (typeof v === "string") {
    try {
      JSON.parse(v);
      return v;
    } catch {
      return stringifyCustom({});
    }
  }
  if (typeof v === "object") return stringifyCustom(v as Record<string, unknown>);
  return "{}";
}

export function packGlobalTokenSaver(config: any) {
  return {
    rtk: config?.tokenSaverRtkEnabled ?? true,
    rtkMaxChars: config?.tokenSaverRtkMaxChars ?? 2000,
    rtkMode: asMode(config?.tokenSaverRtkMode),
    rtkLevel: asLba(config?.tokenSaverRtkLevel),
    rtkCustom: asCustom(config?.tokenSaverRtkCustom),
    headroom: config?.tokenSaverHeadroomEnabled ?? false,
    headroomUrl: config?.tokenSaverHeadroomUrl || "",
    headroomMode: asMode(config?.tokenSaverHeadroomMode),
    headroomLevel: asLba(config?.tokenSaverHeadroomLevel),
    headroomCustom: asCustom(config?.tokenSaverHeadroomCustom),
    caveman: config?.tokenSaverCavemanEnabled ?? false,
    cavemanLevel: config?.tokenSaverCavemanLevel ?? 2,
    cavemanMode: asMode(config?.tokenSaverCavemanMode),
    cavemanCustom: asCustom(config?.tokenSaverCavemanCustom),
    ponytail: config?.tokenSaverPonytailEnabled ?? false,
    ponytailLevel: normalizePonytailLevel(config?.tokenSaverPonytailLevel),
    ponytailMode: asMode(config?.tokenSaverPonytailMode),
    ponytailCustom: asCustom(config?.tokenSaverPonytailCustom),
    groupyCompact: config?.tokenSaverGroupyCompactEnabled ?? true,
    groupyCompactLevel: asLba(config?.tokenSaverGroupyCompactLevel),
    groupyCompactMode: asMode(config?.tokenSaverGroupyCompactMode),
    groupyCompactCustom: asCustom(config?.tokenSaverGroupyCompactCustom),
    batch: config?.tokenSaverBatchEnabled ?? true,
    batchMode: asMode(config?.tokenSaverBatchMode),
    batchLevel: asLba(config?.tokenSaverBatchLevel),
    batchCustom: asCustom(config?.tokenSaverBatchCustom),
    antiWaste: config?.tokenSaverAntiWasteEnabled ?? true,
    antiWasteMode: asMode(config?.tokenSaverAntiWasteMode),
    antiWasteLevel: asLba(config?.tokenSaverAntiWasteLevel),
    antiWasteCustom: asCustom(config?.tokenSaverAntiWasteCustom),
    streamToNonstream: config?.tokenSaverStreamToNonstreamEnabled ?? false,
    nonstreamToStream: config?.tokenSaverNonstreamToStreamEnabled ?? false,
  };
}

export function packUserTokenSaverOverrides(settings: any) {
  return {
    rtk: settings?.tokenSaverRtkOverride ?? null,
    headroom: settings?.tokenSaverHeadroomOverride ?? null,
    caveman: settings?.tokenSaverCavemanOverride ?? null,
    ponytail: settings?.tokenSaverPonytailOverride ?? null,
    groupyCompact: settings?.tokenSaverGroupyCompactOverride ?? null,
    batch: settings?.tokenSaverBatchOverride ?? null,
    antiWaste: settings?.tokenSaverAntiWasteOverride ?? null,
    rtkMode: settings?.tokenSaverRtkModeOverride ?? null,
    rtkLevel: settings?.tokenSaverRtkLevelOverride ?? null,
    rtkCustom: settings?.tokenSaverRtkCustomOverride ?? null,
    headroomMode: settings?.tokenSaverHeadroomModeOverride ?? null,
    headroomLevel: settings?.tokenSaverHeadroomLevelOverride ?? null,
    headroomCustom: settings?.tokenSaverHeadroomCustomOverride ?? null,
    cavemanMode: settings?.tokenSaverCavemanModeOverride ?? null,
    cavemanLevel: settings?.tokenSaverCavemanLevelOverride ?? null,
    cavemanCustom: settings?.tokenSaverCavemanCustomOverride ?? null,
    ponytailMode: settings?.tokenSaverPonytailModeOverride ?? null,
    ponytailLevel: settings?.tokenSaverPonytailLevelOverride ?? null,
    ponytailCustom: settings?.tokenSaverPonytailCustomOverride ?? null,
    groupyCompactMode: settings?.tokenSaverGroupyCompactModeOverride ?? null,
    groupyCompactLevel: settings?.tokenSaverGroupyCompactLevelOverride ?? null,
    groupyCompactCustom: settings?.tokenSaverGroupyCompactCustomOverride ?? null,
    batchMode: settings?.tokenSaverBatchModeOverride ?? null,
    batchLevel: settings?.tokenSaverBatchLevelOverride ?? null,
    batchCustom: settings?.tokenSaverBatchCustomOverride ?? null,
    antiWasteMode: settings?.tokenSaverAntiWasteModeOverride ?? null,
    antiWasteLevel: settings?.tokenSaverAntiWasteLevelOverride ?? null,
    antiWasteCustom: settings?.tokenSaverAntiWasteCustomOverride ?? null,
    streamToNonstream: settings?.tokenSaverStreamToNonstreamOverride ?? null,
    nonstreamToStream: settings?.tokenSaverNonstreamToStreamOverride ?? null,
  };
}

/** Apply admin PUT body fields onto drizzle updates object. */
export function applyAdminTokenSaverUpdates(body: any, updates: Record<string, unknown>) {
  const bool = (k: string, col: string) => {
    if (body[k] !== undefined) updates[col] = !!body[k];
  };
  const mode = (k: string, col: string) => {
    if (body[k] !== undefined) updates[col] = asMode(body[k]);
  };
  const lba = (k: string, col: string) => {
    if (body[k] !== undefined) updates[col] = asLba(body[k]);
  };
  const custom = (k: string, col: string) => {
    if (body[k] !== undefined) updates[col] = asCustom(body[k]);
  };

  // Support both flat tokenSaver* (admin settings) and short names
  const b = {
    ...body,
    rtk: body.tokenSaverRtkEnabled ?? body.rtk,
    rtkMaxChars: body.tokenSaverRtkMaxChars ?? body.rtkMaxChars,
    rtkMode: body.tokenSaverRtkMode ?? body.rtkMode,
    rtkLevel: body.tokenSaverRtkLevel ?? body.rtkLevel,
    rtkCustom: body.tokenSaverRtkCustom ?? body.rtkCustom,
    headroom: body.tokenSaverHeadroomEnabled ?? body.headroom,
    headroomUrl: body.tokenSaverHeadroomUrl ?? body.headroomUrl,
    headroomMode: body.tokenSaverHeadroomMode ?? body.headroomMode,
    headroomLevel: body.tokenSaverHeadroomLevel ?? body.headroomLevel,
    headroomCustom: body.tokenSaverHeadroomCustom ?? body.headroomCustom,
    caveman: body.tokenSaverCavemanEnabled ?? body.caveman,
    cavemanLevel: body.tokenSaverCavemanLevel ?? body.cavemanLevel,
    cavemanMode: body.tokenSaverCavemanMode ?? body.cavemanMode,
    cavemanCustom: body.tokenSaverCavemanCustom ?? body.cavemanCustom,
    ponytail: body.tokenSaverPonytailEnabled ?? body.ponytail,
    ponytailLevel: body.tokenSaverPonytailLevel ?? body.ponytailLevel,
    ponytailMode: body.tokenSaverPonytailMode ?? body.ponytailMode,
    ponytailCustom: body.tokenSaverPonytailCustom ?? body.ponytailCustom,
    groupyCompact: body.tokenSaverGroupyCompactEnabled ?? body.groupyCompact,
    groupyCompactLevel: body.tokenSaverGroupyCompactLevel ?? body.groupyCompactLevel,
    groupyCompactMode: body.tokenSaverGroupyCompactMode ?? body.groupyCompactMode,
    groupyCompactCustom: body.tokenSaverGroupyCompactCustom ?? body.groupyCompactCustom,
    batch: body.tokenSaverBatchEnabled ?? body.batch,
    batchMode: body.tokenSaverBatchMode ?? body.batchMode,
    batchLevel: body.tokenSaverBatchLevel ?? body.batchLevel,
    batchCustom: body.tokenSaverBatchCustom ?? body.batchCustom,
    antiWaste: body.tokenSaverAntiWasteEnabled ?? body.antiWaste,
    antiWasteMode: body.tokenSaverAntiWasteMode ?? body.antiWasteMode,
    antiWasteLevel: body.tokenSaverAntiWasteLevel ?? body.antiWasteLevel,
    antiWasteCustom: body.tokenSaverAntiWasteCustom ?? body.antiWasteCustom,
    streamToNonstream: body.tokenSaverStreamToNonstreamEnabled ?? body.streamToNonstream,
    nonstreamToStream: body.tokenSaverNonstreamToStreamEnabled ?? body.nonstreamToStream,
  };

  if (b.rtk !== undefined) updates.tokenSaverRtkEnabled = !!b.rtk;
  if (b.rtkMaxChars !== undefined) {
    updates.tokenSaverRtkMaxChars = Math.max(200, Number(b.rtkMaxChars) || 2000);
  }
  mode("rtkMode", "tokenSaverRtkMode");
  if (b.rtkMode !== undefined) updates.tokenSaverRtkMode = asMode(b.rtkMode);
  if (b.rtkLevel !== undefined) updates.tokenSaverRtkLevel = asLba(b.rtkLevel);
  if (b.rtkCustom !== undefined) updates.tokenSaverRtkCustom = asCustom(b.rtkCustom);

  if (b.headroom !== undefined) updates.tokenSaverHeadroomEnabled = !!b.headroom;
  if (b.headroomUrl !== undefined) updates.tokenSaverHeadroomUrl = String(b.headroomUrl || "");
  if (b.headroomMode !== undefined) updates.tokenSaverHeadroomMode = asMode(b.headroomMode);
  if (b.headroomLevel !== undefined) updates.tokenSaverHeadroomLevel = asLba(b.headroomLevel);
  if (b.headroomCustom !== undefined) updates.tokenSaverHeadroomCustom = asCustom(b.headroomCustom);

  if (b.caveman !== undefined) updates.tokenSaverCavemanEnabled = !!b.caveman;
  if (b.cavemanLevel !== undefined) {
    updates.tokenSaverCavemanLevel = Math.max(1, Math.min(5, Number(b.cavemanLevel) || 2));
  }
  if (b.cavemanMode !== undefined) updates.tokenSaverCavemanMode = asMode(b.cavemanMode);
  if (b.cavemanCustom !== undefined) updates.tokenSaverCavemanCustom = asCustom(b.cavemanCustom);

  if (b.ponytail !== undefined) updates.tokenSaverPonytailEnabled = !!b.ponytail;
  if (b.ponytailLevel !== undefined) {
    updates.tokenSaverPonytailLevel = normalizePonytailLevel(b.ponytailLevel);
  }
  if (b.ponytailMode !== undefined) updates.tokenSaverPonytailMode = asMode(b.ponytailMode);
  if (b.ponytailCustom !== undefined) updates.tokenSaverPonytailCustom = asCustom(b.ponytailCustom);

  if (b.groupyCompact !== undefined) updates.tokenSaverGroupyCompactEnabled = !!b.groupyCompact;
  if (b.groupyCompactLevel !== undefined) {
    updates.tokenSaverGroupyCompactLevel = asLba(b.groupyCompactLevel);
  }
  if (b.groupyCompactMode !== undefined) {
    updates.tokenSaverGroupyCompactMode = asMode(b.groupyCompactMode);
  }
  if (b.groupyCompactCustom !== undefined) {
    updates.tokenSaverGroupyCompactCustom = asCustom(b.groupyCompactCustom);
  }

  if (b.batch !== undefined) updates.tokenSaverBatchEnabled = !!b.batch;
  if (b.batchMode !== undefined) updates.tokenSaverBatchMode = asMode(b.batchMode);
  if (b.batchLevel !== undefined) updates.tokenSaverBatchLevel = asLba(b.batchLevel);
  if (b.batchCustom !== undefined) updates.tokenSaverBatchCustom = asCustom(b.batchCustom);

  if (b.antiWaste !== undefined) updates.tokenSaverAntiWasteEnabled = !!b.antiWaste;
  if (b.antiWasteMode !== undefined) updates.tokenSaverAntiWasteMode = asMode(b.antiWasteMode);
  if (b.antiWasteLevel !== undefined) updates.tokenSaverAntiWasteLevel = asLba(b.antiWasteLevel);
  if (b.antiWasteCustom !== undefined) {
    updates.tokenSaverAntiWasteCustom = asCustom(b.antiWasteCustom);
  }

  if (b.streamToNonstream !== undefined) {
    updates.tokenSaverStreamToNonstreamEnabled = !!b.streamToNonstream;
  }
  if (b.nonstreamToStream !== undefined) {
    updates.tokenSaverNonstreamToStreamEnabled = !!b.nonstreamToStream;
  }

  void bool;
  void mode;
  void lba;
  void custom;
}

/** Apply portal/Discord user override PUT body. */
export function applyUserTokenSaverUpdates(body: any, updates: Record<string, unknown>) {
  const normalizeBool = (v: unknown): boolean | null => {
    if (v === null || v === "default" || v === "null") return null;
    if (v === true || v === "on" || v === "true" || v === 1) return true;
    if (v === false || v === "off" || v === "false" || v === 0) return false;
    return null;
  };
  const normalizeStr = (v: unknown): string | null => {
    if (v === null || v === undefined || v === "default" || v === "") return null;
    return String(v);
  };

  if (body.rtk !== undefined) updates.tokenSaverRtkOverride = normalizeBool(body.rtk);
  if (body.headroom !== undefined) updates.tokenSaverHeadroomOverride = normalizeBool(body.headroom);
  if (body.caveman !== undefined) updates.tokenSaverCavemanOverride = normalizeBool(body.caveman);
  if (body.ponytail !== undefined) updates.tokenSaverPonytailOverride = normalizeBool(body.ponytail);
  if (body.groupyCompact !== undefined) {
    updates.tokenSaverGroupyCompactOverride = normalizeBool(body.groupyCompact);
  }
  if (body.batch !== undefined) updates.tokenSaverBatchOverride = normalizeBool(body.batch);
  if (body.antiWaste !== undefined) updates.tokenSaverAntiWasteOverride = normalizeBool(body.antiWaste);
  if (body.streamToNonstream !== undefined) {
    updates.tokenSaverStreamToNonstreamOverride = normalizeBool(body.streamToNonstream);
  }
  if (body.nonstreamToStream !== undefined) {
    updates.tokenSaverNonstreamToStreamOverride = normalizeBool(body.nonstreamToStream);
  }

  if (body.rtkMode !== undefined) updates.tokenSaverRtkModeOverride = normalizeStr(body.rtkMode);
  if (body.rtkLevel !== undefined) updates.tokenSaverRtkLevelOverride = normalizeStr(body.rtkLevel);
  if (body.rtkCustom !== undefined) {
    updates.tokenSaverRtkCustomOverride =
      body.rtkCustom === null ? null : asCustom(body.rtkCustom);
  }
  if (body.headroomMode !== undefined) {
    updates.tokenSaverHeadroomModeOverride = normalizeStr(body.headroomMode);
  }
  if (body.headroomLevel !== undefined) {
    updates.tokenSaverHeadroomLevelOverride = normalizeStr(body.headroomLevel);
  }
  if (body.headroomCustom !== undefined) {
    updates.tokenSaverHeadroomCustomOverride =
      body.headroomCustom === null ? null : asCustom(body.headroomCustom);
  }
  if (body.cavemanMode !== undefined) {
    updates.tokenSaverCavemanModeOverride = normalizeStr(body.cavemanMode);
  }
  if (body.cavemanLevel !== undefined) {
    updates.tokenSaverCavemanLevelOverride =
      body.cavemanLevel === null || body.cavemanLevel === "default"
        ? null
        : Math.max(1, Math.min(5, Number(body.cavemanLevel) || 2));
  }
  if (body.cavemanCustom !== undefined) {
    updates.tokenSaverCavemanCustomOverride =
      body.cavemanCustom === null ? null : asCustom(body.cavemanCustom);
  }
  if (body.ponytailMode !== undefined) {
    updates.tokenSaverPonytailModeOverride = normalizeStr(body.ponytailMode);
  }
  if (body.ponytailLevel !== undefined) {
    updates.tokenSaverPonytailLevelOverride = normalizeStr(body.ponytailLevel);
  }
  if (body.ponytailCustom !== undefined) {
    updates.tokenSaverPonytailCustomOverride =
      body.ponytailCustom === null ? null : asCustom(body.ponytailCustom);
  }
  if (body.groupyCompactMode !== undefined) {
    updates.tokenSaverGroupyCompactModeOverride = normalizeStr(body.groupyCompactMode);
  }
  if (body.groupyCompactLevel !== undefined) {
    updates.tokenSaverGroupyCompactLevelOverride = normalizeStr(body.groupyCompactLevel);
  }
  if (body.groupyCompactCustom !== undefined) {
    updates.tokenSaverGroupyCompactCustomOverride =
      body.groupyCompactCustom === null ? null : asCustom(body.groupyCompactCustom);
  }
  if (body.batchMode !== undefined) updates.tokenSaverBatchModeOverride = normalizeStr(body.batchMode);
  if (body.batchLevel !== undefined) {
    updates.tokenSaverBatchLevelOverride = normalizeStr(body.batchLevel);
  }
  if (body.batchCustom !== undefined) {
    updates.tokenSaverBatchCustomOverride =
      body.batchCustom === null ? null : asCustom(body.batchCustom);
  }
  if (body.antiWasteMode !== undefined) {
    updates.tokenSaverAntiWasteModeOverride = normalizeStr(body.antiWasteMode);
  }
  if (body.antiWasteLevel !== undefined) {
    updates.tokenSaverAntiWasteLevelOverride = normalizeStr(body.antiWasteLevel);
  }
  if (body.antiWasteCustom !== undefined) {
    updates.tokenSaverAntiWasteCustomOverride =
      body.antiWasteCustom === null ? null : asCustom(body.antiWasteCustom);
  }
}
