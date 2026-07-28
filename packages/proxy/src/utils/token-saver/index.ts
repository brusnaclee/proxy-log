// Token Saver pipeline (9router order + Groupy Compact):
//   RTK → Groupy Compact → Headroom → Caveman → Ponytail → Batch
// Anti-Waste runs separately (pre-upstream) but resolves via the same flags.
//
// Resolution priority for each feature:
//   1. Request header `X-Token-Saver: off` → disable ALL pipeline (+ anti-waste if we gate it)
//   2. Per-user portal override (true/false) if set
//   3. Global admin_config default
// Intensity: user mode/level/custom → global mode/level/custom → code defaults

import { applyRtk, type RtkStats } from './rtk.js';
import { applyHeadroom, type HeadroomStats } from './headroom.js';
import { applyCaveman } from './caveman.js';
import { applyPonytail } from './ponytail.js';
import { applyBatch } from './batch.js';
import {
	applyGroupyCompact,
	normalizeGroupyCompactLevel,
	type GroupyCompactLevel,
	type GroupyCompactStats,
} from './groupy-compact.js';
import {
	normalizeMode,
	normalizeLba,
	normalizePonytailLevel,
	resolveAntiWasteThresholds,
	resolveCompactParams,
	resolveBatchParams,
	resolveRtkParams,
	resolveHeadroomParams,
	resolveCavemanParams,
	resolvePonytailParams,
	type IntensityMode,
	type LiteBalancedAggressive,
	type AntiWasteThresholds,
	type PonytailLevel,
} from './intensity.js';

export interface TokenSaverGlobalConfig {
	tokenSaverRtkEnabled?: boolean | null;
	tokenSaverRtkMaxChars?: number | null;
	tokenSaverRtkMode?: string | null;
	tokenSaverRtkLevel?: string | null;
	tokenSaverRtkCustom?: string | null;
	tokenSaverHeadroomEnabled?: boolean | null;
	tokenSaverHeadroomUrl?: string | null;
	tokenSaverHeadroomMode?: string | null;
	tokenSaverHeadroomLevel?: string | null;
	tokenSaverHeadroomCustom?: string | null;
	tokenSaverCavemanEnabled?: boolean | null;
	tokenSaverCavemanLevel?: number | null;
	tokenSaverCavemanMode?: string | null;
	tokenSaverCavemanCustom?: string | null;
	tokenSaverPonytailEnabled?: boolean | null;
	tokenSaverPonytailLevel?: string | null;
	tokenSaverPonytailMode?: string | null;
	tokenSaverPonytailCustom?: string | null;
	tokenSaverGroupyCompactEnabled?: boolean | null;
	tokenSaverGroupyCompactLevel?: string | null;
	tokenSaverGroupyCompactMode?: string | null;
	tokenSaverGroupyCompactCustom?: string | null;
	tokenSaverBatchEnabled?: boolean | null;
	tokenSaverBatchMode?: string | null;
	tokenSaverBatchLevel?: string | null;
	tokenSaverBatchCustom?: string | null;
	tokenSaverAntiWasteEnabled?: boolean | null;
	tokenSaverAntiWasteMode?: string | null;
	tokenSaverAntiWasteLevel?: string | null;
	tokenSaverAntiWasteCustom?: string | null;
}

export interface TokenSaverUserOverrides {
	tokenSaverRtkOverride?: boolean | null;
	tokenSaverHeadroomOverride?: boolean | null;
	tokenSaverCavemanOverride?: boolean | null;
	tokenSaverPonytailOverride?: boolean | null;
	tokenSaverGroupyCompactOverride?: boolean | null;
	tokenSaverBatchOverride?: boolean | null;
	tokenSaverAntiWasteOverride?: boolean | null;
	tokenSaverRtkModeOverride?: string | null;
	tokenSaverRtkLevelOverride?: string | null;
	tokenSaverRtkCustomOverride?: string | null;
	tokenSaverHeadroomModeOverride?: string | null;
	tokenSaverHeadroomLevelOverride?: string | null;
	tokenSaverHeadroomCustomOverride?: string | null;
	tokenSaverCavemanModeOverride?: string | null;
	tokenSaverCavemanLevelOverride?: number | null;
	tokenSaverCavemanCustomOverride?: string | null;
	tokenSaverPonytailModeOverride?: string | null;
	tokenSaverPonytailLevelOverride?: string | null;
	tokenSaverPonytailCustomOverride?: string | null;
	tokenSaverGroupyCompactModeOverride?: string | null;
	tokenSaverGroupyCompactLevelOverride?: string | null;
	tokenSaverGroupyCompactCustomOverride?: string | null;
	tokenSaverBatchModeOverride?: string | null;
	tokenSaverBatchLevelOverride?: string | null;
	tokenSaverBatchCustomOverride?: string | null;
	tokenSaverAntiWasteModeOverride?: string | null;
	tokenSaverAntiWasteLevelOverride?: string | null;
	tokenSaverAntiWasteCustomOverride?: string | null;
}

export interface EffectiveTokenSaverFlags {
	rtk: boolean;
	rtkMaxChars: number;
	groupyCompact: boolean;
	groupyCompactLevel: GroupyCompactLevel;
	groupyCompactRecentKeep: number;
	groupyCompactMinChars: number;
	groupyCompactAssistantProseMax: number;
	headroom: boolean;
	headroomUrl: string;
	headroomTimeoutMs: number;
	caveman: boolean;
	cavemanLevel: number;
	ponytail: boolean;
	ponytailLevel: PonytailLevel;
	batch: boolean;
	batchStrength: number;
	antiWaste: boolean;
	antiWasteThresholds: AntiWasteThresholds;
	disabledByHeader: boolean;
}

export interface TokenSaverResult {
	applied: EffectiveTokenSaverFlags;
	rtk?: RtkStats;
	groupyCompact?: GroupyCompactStats;
	headroom?: HeadroomStats;
	caveman: boolean;
	ponytail: boolean;
	batch: boolean;
}

function resolveFlag(
	override: boolean | null | undefined,
	globalDefault: boolean | null | undefined,
	fallback: boolean,
): boolean {
	if (override === true || override === false) return override;
	if (globalDefault === true || globalDefault === false) return globalDefault;
	return fallback;
}

function pickMode(
	userMode: string | null | undefined,
	globalMode: string | null | undefined,
): IntensityMode {
	if (userMode === 'preset' || userMode === 'custom') return userMode;
	return normalizeMode(globalMode);
}

function pickLba(
	userLevel: string | null | undefined,
	globalLevel: string | null | undefined,
	fallback: LiteBalancedAggressive = 'balanced',
): LiteBalancedAggressive {
	if (userLevel != null && String(userLevel).trim() !== '') {
		return normalizeLba(userLevel, fallback);
	}
	return normalizeLba(globalLevel, fallback);
}

function pickCustom(
	userCustom: string | null | undefined,
	globalCustom: string | null | undefined,
): string {
	if (userCustom != null && String(userCustom).trim() !== '') return String(userCustom);
	return String(globalCustom || '{}');
}

export function resolveTokenSaverFlags(
	globalCfg: TokenSaverGlobalConfig | null | undefined,
	userOverrides: TokenSaverUserOverrides | null | undefined,
	headers?: Headers | Record<string, string | undefined> | null,
): EffectiveTokenSaverFlags {
	const headerOff = (() => {
		if (!headers) return false;
		const get = (k: string): string | undefined => {
			if (typeof (headers as Headers).get === 'function') {
				return (headers as Headers).get(k) || undefined;
			}
			const rec = headers as Record<string, string | undefined>;
			return rec[k] ?? rec[k.toLowerCase()];
		};
		const raw = (get('x-token-saver') || get('X-Token-Saver') || '').trim().toLowerCase();
		return raw === 'off' || raw === '0' || raw === 'false' || raw === 'disabled';
	})();

	const rtkMode = pickMode(userOverrides?.tokenSaverRtkModeOverride, globalCfg?.tokenSaverRtkMode);
	const rtkLevel = pickLba(userOverrides?.tokenSaverRtkLevelOverride, globalCfg?.tokenSaverRtkLevel, 'balanced');
	const rtkCustom = pickCustom(userOverrides?.tokenSaverRtkCustomOverride, globalCfg?.tokenSaverRtkCustom);
	const rtkParams = resolveRtkParams(rtkMode, rtkLevel, rtkCustom, globalCfg?.tokenSaverRtkMaxChars);

	const compactMode = pickMode(
		userOverrides?.tokenSaverGroupyCompactModeOverride,
		globalCfg?.tokenSaverGroupyCompactMode,
	);
	const compactLevel = pickLba(
		userOverrides?.tokenSaverGroupyCompactLevelOverride,
		globalCfg?.tokenSaverGroupyCompactLevel,
		'balanced',
	);
	const compactCustom = pickCustom(
		userOverrides?.tokenSaverGroupyCompactCustomOverride,
		globalCfg?.tokenSaverGroupyCompactCustom,
	);
	const compactParams = resolveCompactParams(compactMode, compactLevel, compactCustom);

	const batchMode = pickMode(userOverrides?.tokenSaverBatchModeOverride, globalCfg?.tokenSaverBatchMode);
	const batchLevel = pickLba(userOverrides?.tokenSaverBatchLevelOverride, globalCfg?.tokenSaverBatchLevel, 'balanced');
	const batchCustom = pickCustom(userOverrides?.tokenSaverBatchCustomOverride, globalCfg?.tokenSaverBatchCustom);
	const batchParams = resolveBatchParams(batchMode, batchLevel, batchCustom);

	const headroomMode = pickMode(
		userOverrides?.tokenSaverHeadroomModeOverride,
		globalCfg?.tokenSaverHeadroomMode,
	);
	const headroomLevel = pickLba(
		userOverrides?.tokenSaverHeadroomLevelOverride,
		globalCfg?.tokenSaverHeadroomLevel,
		'balanced',
	);
	const headroomCustom = pickCustom(
		userOverrides?.tokenSaverHeadroomCustomOverride,
		globalCfg?.tokenSaverHeadroomCustom,
	);
	const headroomParams = resolveHeadroomParams(headroomMode, headroomLevel, headroomCustom);

	const cavemanMode = pickMode(
		userOverrides?.tokenSaverCavemanModeOverride,
		globalCfg?.tokenSaverCavemanMode,
	);
	const cavemanLevelSrc =
		userOverrides?.tokenSaverCavemanLevelOverride ?? globalCfg?.tokenSaverCavemanLevel;
	const cavemanCustom = pickCustom(
		userOverrides?.tokenSaverCavemanCustomOverride,
		globalCfg?.tokenSaverCavemanCustom,
	);
	const cavemanParams = resolveCavemanParams(cavemanMode, cavemanLevelSrc, cavemanCustom);

	const ponytailMode = pickMode(
		userOverrides?.tokenSaverPonytailModeOverride,
		globalCfg?.tokenSaverPonytailMode,
	);
	const ponytailLevelSrc =
		userOverrides?.tokenSaverPonytailLevelOverride ?? globalCfg?.tokenSaverPonytailLevel;
	const ponytailCustom = pickCustom(
		userOverrides?.tokenSaverPonytailCustomOverride,
		globalCfg?.tokenSaverPonytailCustom,
	);
	const ponytailParams = resolvePonytailParams(ponytailMode, ponytailLevelSrc, ponytailCustom);

	const awMode = pickMode(
		userOverrides?.tokenSaverAntiWasteModeOverride,
		globalCfg?.tokenSaverAntiWasteMode,
	);
	const awLevel = pickLba(
		userOverrides?.tokenSaverAntiWasteLevelOverride,
		globalCfg?.tokenSaverAntiWasteLevel,
		'balanced',
	);
	const awCustom = pickCustom(
		userOverrides?.tokenSaverAntiWasteCustomOverride,
		globalCfg?.tokenSaverAntiWasteCustom,
	);
	const awThresholds = resolveAntiWasteThresholds(awMode, awLevel, awCustom);

	const emptyAw = { nudgeAt: 3, dedupeAt: 4, shortCircuitAt: 8 };

	if (headerOff) {
		return {
			rtk: false,
			rtkMaxChars: rtkParams.maxChars,
			groupyCompact: false,
			groupyCompactLevel: normalizeGroupyCompactLevel(compactParams.levelLabel),
			groupyCompactRecentKeep: compactParams.recentKeep,
			groupyCompactMinChars: compactParams.minChars,
			groupyCompactAssistantProseMax: compactParams.assistantProseMax,
			headroom: false,
			headroomUrl: String(globalCfg?.tokenSaverHeadroomUrl || ''),
			headroomTimeoutMs: headroomParams.timeoutMs,
			caveman: false,
			cavemanLevel: cavemanParams.level,
			ponytail: false,
			ponytailLevel: ponytailParams.level,
			batch: false,
			batchStrength: batchParams.strength,
			antiWaste: false,
			antiWasteThresholds: emptyAw,
			disabledByHeader: true,
		};
	}

	return {
		rtk: resolveFlag(userOverrides?.tokenSaverRtkOverride, globalCfg?.tokenSaverRtkEnabled, true),
		rtkMaxChars: rtkParams.maxChars,
		groupyCompact: resolveFlag(
			userOverrides?.tokenSaverGroupyCompactOverride,
			globalCfg?.tokenSaverGroupyCompactEnabled,
			true,
		),
		groupyCompactLevel: normalizeGroupyCompactLevel(compactParams.levelLabel),
		groupyCompactRecentKeep: compactParams.recentKeep,
		groupyCompactMinChars: compactParams.minChars,
		groupyCompactAssistantProseMax: compactParams.assistantProseMax,
		headroom: resolveFlag(
			userOverrides?.tokenSaverHeadroomOverride,
			globalCfg?.tokenSaverHeadroomEnabled,
			false,
		),
		headroomUrl: String(globalCfg?.tokenSaverHeadroomUrl || ''),
		headroomTimeoutMs: headroomParams.timeoutMs,
		caveman: resolveFlag(
			userOverrides?.tokenSaverCavemanOverride,
			globalCfg?.tokenSaverCavemanEnabled,
			false,
		),
		cavemanLevel: cavemanParams.level,
		ponytail: resolveFlag(
			userOverrides?.tokenSaverPonytailOverride,
			globalCfg?.tokenSaverPonytailEnabled,
			false,
		),
		ponytailLevel: ponytailParams.level,
		batch: resolveFlag(
			userOverrides?.tokenSaverBatchOverride,
			globalCfg?.tokenSaverBatchEnabled,
			true,
		),
		batchStrength: batchParams.strength,
		antiWaste: resolveFlag(
			userOverrides?.tokenSaverAntiWasteOverride,
			globalCfg?.tokenSaverAntiWasteEnabled,
			true,
		),
		antiWasteThresholds: awThresholds,
		disabledByHeader: false,
	};
}

function requestHasTools(body: any): boolean {
	if (Array.isArray(body?.tools) && body.tools.length > 0) return true;
	if (!Array.isArray(body?.messages)) return false;
	return body.messages.some(
		(m: any) =>
			Array.isArray(m?.tool_calls) ||
			String(m?.role || '').toLowerCase() === 'tool' ||
			(Array.isArray(m?.content) &&
				m.content.some(
					(p: any) =>
						p?.type === 'tool_result' || p?.type === 'tool_use',
				)),
	);
}

function isTinyChat(body: any): boolean {
	if (!Array.isArray(body?.messages) || body.messages.length > 4) return false;
	try {
		return JSON.stringify(body.messages).length < 1500;
	} catch {
		return false;
	}
}

/**
 * Apply the full Token Saver pipeline in-place on an OpenAI-format request body.
 * Order: RTK → Groupy Compact → Headroom → Caveman → Ponytail → Batch.
 */
export async function applyTokenSavers(
	body: any,
	flags: EffectiveTokenSaverFlags,
	opts?: { ide?: string | null },
): Promise<TokenSaverResult> {
	const result: TokenSaverResult = {
		applied: flags,
		caveman: false,
		ponytail: false,
		batch: false,
	};
	if (!body || !Array.isArray(body.messages)) return result;

	const hasTools = requestHasTools(body);
	const tiny = isTinyChat(body);

	if (flags.rtk) {
		result.rtk = applyRtk(body, flags.rtkMaxChars);
	}
	if (flags.groupyCompact && !tiny) {
		result.groupyCompact = applyGroupyCompact(body, flags.groupyCompactLevel, {
			recentKeep: flags.groupyCompactRecentKeep,
			minChars: flags.groupyCompactMinChars,
			assistantProseMax: flags.groupyCompactAssistantProseMax,
		});
	}
	if (flags.headroom && flags.headroomUrl) {
		result.headroom = await applyHeadroom(body, flags.headroomUrl, flags.headroomTimeoutMs);
	}
	const allowCaveman =
		flags.caveman && !tiny && (!hasTools || flags.cavemanLevel >= 4);
	if (allowCaveman) {
		result.caveman = applyCaveman(body, flags.cavemanLevel);
	}
	if (flags.ponytail && !tiny) {
		result.ponytail = applyPonytail(body, flags.ponytailLevel);
	}
	if (flags.batch && hasTools) {
		result.batch = applyBatch(body, opts?.ide, flags.batchStrength);
	}
	return result;
}

export { applyRtk } from './rtk.js';
export { applyHeadroom } from './headroom.js';
export { applyCaveman, getCavemanPrompt } from './caveman.js';
export { applyPonytail, getPonytailPrompt } from './ponytail.js';
export { applyBatch, getBatchPrompt } from './batch.js';
export { applyGroupyCompact, normalizeGroupyCompactLevel } from './groupy-compact.js';
export * from './intensity.js';
export { normalizePonytailLevel };
