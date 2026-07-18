// Token Saver pipeline (9router order):
//   RTK → Headroom → Caveman → Ponytail
//
// Resolution priority for each feature:
//   1. Request header `X-Token-Saver: off` → disable ALL
//   2. Per-user portal override (true/false) if set
//   3. Global admin_config default

import { applyRtk, type RtkStats } from './rtk.js';
import { applyHeadroom, type HeadroomStats } from './headroom.js';
import { applyCaveman } from './caveman.js';
import { applyPonytail } from './ponytail.js';

export interface TokenSaverGlobalConfig {
	tokenSaverRtkEnabled?: boolean | null;
	tokenSaverRtkMaxChars?: number | null;
	tokenSaverHeadroomEnabled?: boolean | null;
	tokenSaverHeadroomUrl?: string | null;
	tokenSaverCavemanEnabled?: boolean | null;
	tokenSaverCavemanLevel?: number | null;
	tokenSaverPonytailEnabled?: boolean | null;
	tokenSaverPonytailLevel?: string | null;
}

export interface TokenSaverUserOverrides {
	tokenSaverRtkOverride?: boolean | null;
	tokenSaverHeadroomOverride?: boolean | null;
	tokenSaverCavemanOverride?: boolean | null;
	tokenSaverPonytailOverride?: boolean | null;
}

export interface EffectiveTokenSaverFlags {
	rtk: boolean;
	rtkMaxChars: number;
	headroom: boolean;
	headroomUrl: string;
	caveman: boolean;
	cavemanLevel: number;
	ponytail: boolean;
	ponytailLevel: string;
	disabledByHeader: boolean;
}

export interface TokenSaverResult {
	applied: EffectiveTokenSaverFlags;
	rtk?: RtkStats;
	headroom?: HeadroomStats;
	caveman: boolean;
	ponytail: boolean;
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

	if (headerOff) {
		return {
			rtk: false,
			rtkMaxChars: Number(globalCfg?.tokenSaverRtkMaxChars) || 2000,
			headroom: false,
			headroomUrl: String(globalCfg?.tokenSaverHeadroomUrl || ''),
			caveman: false,
			cavemanLevel: Number(globalCfg?.tokenSaverCavemanLevel) || 2,
			ponytail: false,
			ponytailLevel: String(globalCfg?.tokenSaverPonytailLevel || 'lite'),
			disabledByHeader: true,
		};
	}

	return {
		rtk: resolveFlag(userOverrides?.tokenSaverRtkOverride, globalCfg?.tokenSaverRtkEnabled, true),
		rtkMaxChars: Math.max(200, Number(globalCfg?.tokenSaverRtkMaxChars) || 2000),
		headroom: resolveFlag(
			userOverrides?.tokenSaverHeadroomOverride,
			globalCfg?.tokenSaverHeadroomEnabled,
			false,
		),
		headroomUrl: String(globalCfg?.tokenSaverHeadroomUrl || ''),
		caveman: resolveFlag(
			userOverrides?.tokenSaverCavemanOverride,
			globalCfg?.tokenSaverCavemanEnabled,
			false,
		),
		cavemanLevel: Math.max(1, Math.min(5, Number(globalCfg?.tokenSaverCavemanLevel) || 2)),
		ponytail: resolveFlag(
			userOverrides?.tokenSaverPonytailOverride,
			globalCfg?.tokenSaverPonytailEnabled,
			false,
		),
		ponytailLevel: String(globalCfg?.tokenSaverPonytailLevel || 'lite'),
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
 * Order matches 9router: RTK → Headroom → Caveman → Ponytail.
 *
 * Research note (2026): Caveman can raise total tokens on tool-heavy agents;
 * skip it when tools are present unless level ≥ 4. Skip Caveman/Ponytail on
 * tiny chats — the injected system lines would cost more than they save.
 */
export async function applyTokenSavers(
	body: any,
	flags: EffectiveTokenSaverFlags,
): Promise<TokenSaverResult> {
	const result: TokenSaverResult = {
		applied: flags,
		caveman: false,
		ponytail: false,
	};
	if (!body || !Array.isArray(body.messages)) return result;

	const hasTools = requestHasTools(body);
	const tiny = isTinyChat(body);

	if (flags.rtk) {
		result.rtk = applyRtk(body, flags.rtkMaxChars);
	}
	if (flags.headroom && flags.headroomUrl) {
		result.headroom = await applyHeadroom(body, flags.headroomUrl);
	}
	const allowCaveman =
		flags.caveman && !tiny && (!hasTools || flags.cavemanLevel >= 4);
	if (allowCaveman) {
		result.caveman = applyCaveman(body, flags.cavemanLevel);
	}
	// Ponytail helps long tool loops; skip on tiny one-shot chats.
	if (flags.ponytail && !tiny) {
		result.ponytail = applyPonytail(body, flags.ponytailLevel);
	}
	return result;
}

export { applyRtk } from './rtk.js';
export { applyHeadroom } from './headroom.js';
export { applyCaveman, getCavemanPrompt } from './caveman.js';
export { applyPonytail, getPonytailPrompt } from './ponytail.js';
