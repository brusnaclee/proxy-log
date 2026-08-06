/**
 * Device slot helpers — collapse multi-IDE / legacy fingerprints into one
 * machine slot so maxDevices does not false-rotate keys.
 */

import { extractMachineHint, generateFingerprint, legacyFingerprintCandidates } from './crypto.js';

export type DeviceRowLike = {
	id: number;
	apiKeyId?: number;
	api_key_id?: number;
	fingerprint: string;
	userAgentRaw?: string | null;
	user_agent_raw?: string | null;
	osDetected?: string | null;
	os_detected?: string | null;
	isBlocked?: boolean | null;
	is_blocked?: boolean | null;
	lastSeen?: Date | string | null;
	last_seen?: Date | string | null;
	requestCount?: number | null;
	request_count?: number | null;
	ipAddress?: string | null;
	ip_address?: string | null;
	deviceName?: string | null;
	device_name?: string | null;
	ideDetected?: string | null;
	ide_detected?: string | null;
	firstSeen?: Date | string | null;
	first_seen?: Date | string | null;
};

function uaOf(d: DeviceRowLike): string {
	return String(d.userAgentRaw ?? d.user_agent_raw ?? '');
}

function osOf(d: DeviceRowLike): string {
	return String(d.osDetected ?? d.os_detected ?? '');
}

export function machineKeyOfDevice(d: DeviceRowLike): string {
	return extractMachineHint(uaOf(d), osOf(d) || null);
}

export function normalizeDeviceRow(d: DeviceRowLike): {
	id: number;
	apiKeyId: number;
	fingerprint: string;
	ipAddress: string | null;
	userAgentRaw: string | null;
	osDetected: string | null;
	deviceName: string | null;
	ideDetected: string | null;
	firstSeen: any;
	lastSeen: any;
	requestCount: number;
	isBlocked: boolean;
} {
	return {
		id: d.id,
		apiKeyId: Number(d.apiKeyId ?? d.api_key_id),
		fingerprint: d.fingerprint,
		ipAddress: (d.ipAddress ?? d.ip_address) as string | null,
		userAgentRaw: (d.userAgentRaw ?? d.user_agent_raw) as string | null,
		osDetected: (d.osDetected ?? d.os_detected) as string | null,
		deviceName: (d.deviceName ?? d.device_name) as string | null,
		ideDetected: (d.ideDetected ?? d.ide_detected) as string | null,
		firstSeen: d.firstSeen ?? d.first_seen,
		lastSeen: d.lastSeen ?? d.last_seen,
		requestCount: Number(d.requestCount ?? d.request_count ?? 0),
		isBlocked: Boolean(d.isBlocked ?? d.is_blocked),
	};
}

/**
 * Pick the existing device row that belongs to the same physical machine,
 * even if its stored fingerprint is from an older era (IP/UA/device-id).
 */
export function findSameMachineDevice(
	rows: DeviceRowLike[],
	opts: {
		canonicalFingerprint: string;
		userAgent: string;
		osDetected?: string | null;
		deviceId?: string;
	},
): DeviceRowLike | null {
	const machine = extractMachineHint(opts.userAgent, opts.osDetected);
	const legacy = new Set(
		legacyFingerprintCandidates(opts.userAgent, opts.deviceId || ''),
	);
	legacy.add(opts.canonicalFingerprint);

	// 1) Exact canonical / legacy fingerprint match
	const byFp = rows.find((d) => legacy.has(d.fingerprint));
	if (byFp) return byFp;

	// 2) Same OS+arch from stored UA / os_detected
	if (machine && machine !== 'unknown:') {
		const byMachine = rows.find((d) => {
			const hint = machineKeyOfDevice(d);
			return hint === machine && hint !== 'unknown:';
		});
		if (byMachine) return byMachine;

		// OS-less legacy row on an account that already has this machine — absorb it
		const osLess = rows.find((d) => {
			const hint = machineKeyOfDevice(d);
			return !hint || hint === 'unknown:';
		});
		if (osLess) return osLess;
	}

	// 3) Current request is OS-less (Cline/Kilo/OpenCode) but account already has
	// exactly one known OS+arch slot → same PC, sticky merge (stops IDE-switch rotates).
	if (!machine || machine === 'unknown:') {
		const known = rows.filter((d) => {
			const hint = machineKeyOfDevice(d);
			return hint && hint !== 'unknown:';
		});
		const hints = new Set(known.map((d) => machineKeyOfDevice(d)));
		if (hints.size === 1 && known.length > 0) {
			return known[0];
		}
		// All-unknown account: prefer any existing unknown/shared row
		const anyUnknown = rows.find((d) => {
			const hint = machineKeyOfDevice(d);
			return !hint || hint === 'unknown:';
		});
		if (anyUnknown) return anyUnknown;
	}

	return null;
}

/**
 * Count distinct physical machines (not raw fingerprint strings).
 * - Known OS+arch rows collapse by normalized hint.
 * - OS-less / legacy UA rows do NOT add slots when a known machine exists
 *   (Cursor with OS UA + Cline without OS = 1 device).
 * - If the account only has OS-less rows, count as 1 machine (shared bucket),
 *   not N legacy ua: fingerprints.
 */
export function countDistinctMachines(rows: DeviceRowLike[]): number {
	const known = new Set<string>();
	let hasUnknown = false;
	for (const d of rows) {
		const hint = machineKeyOfDevice(d);
		if (hint && hint !== 'unknown:') {
			known.add(`m:${hint}`);
		} else {
			hasUnknown = true;
		}
	}
	if (known.size > 0) return known.size;
	return hasUnknown ? 1 : 0;
}

/**
 * Among rows for one account, return ids to delete when consolidating onto
 * the keeper row for the current machine. Keeps other *different* machines.
 * Also drops OS-less / legacy unknown rows when the keeper is a known OS+arch.
 */
export function siblingIdsToDeleteOnSameMachine(
	rows: DeviceRowLike[],
	keeperId: number,
	machineHint: string,
): number[] {
	if (!machineHint || machineHint === 'unknown:') {
		// All-unknown consolidate: delete every other unknown/legacy row
		return rows
			.filter((d) => {
				if (d.id === keeperId) return false;
				const hint = machineKeyOfDevice(d);
				return !hint || hint === 'unknown:';
			})
			.map((d) => d.id);
	}
	return rows
		.filter((d) => {
			if (d.id === keeperId) return false;
			const hint = machineKeyOfDevice(d);
			return hint === machineHint || !hint || hint === 'unknown:';
		})
		.map((d) => d.id);
}

export function canonicalFingerprintForRequest(
	userAgent: string,
	osDetected?: string | null,
	deviceId?: string,
): string {
	return generateFingerprint('', userAgent, deviceId || '', osDetected);
}
