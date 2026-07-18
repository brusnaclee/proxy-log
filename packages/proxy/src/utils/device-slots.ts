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
	}

	return null;
}

/**
 * Count distinct physical machines (not raw fingerprint strings).
 * Legacy IP/UA rows on the same OS+arch collapse into one.
 */
export function countDistinctMachines(rows: DeviceRowLike[]): number {
	const keys = new Set<string>();
	for (const d of rows) {
		const hint = machineKeyOfDevice(d);
		if (hint && hint !== 'unknown:') {
			keys.add(`m:${hint}`);
		} else {
			keys.add(`f:${d.fingerprint}`);
		}
	}
	return keys.size;
}

/**
 * Among rows for one account, return ids to delete when consolidating onto
 * the keeper row for the current machine. Keeps other *different* machines.
 */
export function siblingIdsToDeleteOnSameMachine(
	rows: DeviceRowLike[],
	keeperId: number,
	machineHint: string,
): number[] {
	if (!machineHint || machineHint === 'unknown:') return [];
	return rows
		.filter((d) => d.id !== keeperId && machineKeyOfDevice(d) === machineHint)
		.map((d) => d.id);
}

export function canonicalFingerprintForRequest(
	userAgent: string,
	osDetected?: string | null,
	deviceId?: string,
): string {
	return generateFingerprint('', userAgent, deviceId || '', osDetected);
}
