/**
 * Device slot helpers — fingerprint = machine|ide (IDE change = new slot).
 * Legacy machine-only / ua: / device: hashes can still be matched for migration.
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
	ideDetected?: string | null;
	ide_detected?: string | null;
	isBlocked?: boolean | null;
	is_blocked?: boolean | null;
	isProvisional?: boolean | null;
	is_provisional?: boolean | null;
	lastSeen?: Date | string | null;
	last_seen?: Date | string | null;
	requestCount?: number | null;
	request_count?: number | null;
	ipAddress?: string | null;
	ip_address?: string | null;
	deviceName?: string | null;
	device_name?: string | null;
	firstSeen?: Date | string | null;
	first_seen?: Date | string | null;
};

function uaOf(d: DeviceRowLike): string {
	return String(d.userAgentRaw ?? d.user_agent_raw ?? '');
}

function osOf(d: DeviceRowLike): string {
	return String(d.osDetected ?? d.os_detected ?? '');
}

function ideOf(d: DeviceRowLike): string {
	return String(d.ideDetected ?? d.ide_detected ?? 'unknown');
}

export function isProvisionalDevice(d: DeviceRowLike): boolean {
	return Boolean(d.isProvisional ?? d.is_provisional);
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
	isProvisional: boolean;
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
		isProvisional: isProvisionalDevice(d),
	};
}

/** Registered (non-provisional) slots count toward maxDevices. */
export function countRegisteredSlots(rows: DeviceRowLike[]): number {
	const fps = new Set<string>();
	for (const d of rows) {
		if (isProvisionalDevice(d)) continue;
		if (d.isBlocked ?? d.is_blocked) continue;
		fps.add(d.fingerprint);
	}
	return fps.size;
}

/** @deprecated use countRegisteredSlots — kept for older imports */
export function countDistinctMachines(rows: DeviceRowLike[]): number {
	return countRegisteredSlots(rows);
}

/**
 * Find an existing row for this request fingerprint (canonical or legacy).
 * Does NOT merge different IDEs onto one machine.
 */
export function findSameMachineDevice(
	rows: DeviceRowLike[],
	opts: {
		canonicalFingerprint: string;
		userAgent: string;
		osDetected?: string | null;
		deviceId?: string;
		ideName?: string | null;
	},
): DeviceRowLike | null {
	const legacy = new Set(
		legacyFingerprintCandidates(opts.userAgent, opts.deviceId || ''),
	);
	legacy.add(opts.canonicalFingerprint);
	// Also accept recompute from stored-style inputs
	if (opts.ideName) {
		legacy.add(
			generateFingerprint(
				'',
				opts.userAgent,
				opts.deviceId || '',
				opts.osDetected,
				opts.ideName,
			),
		);
	}

	const byFp = rows.find((d) => legacy.has(d.fingerprint));
	if (byFp) return byFp;

	return null;
}

/**
 * Delete duplicate rows with the exact same fingerprint (legacy dupes).
 * Does not delete other IDEs.
 */
export function siblingIdsToDeleteOnSameMachine(
	rows: DeviceRowLike[],
	keeperId: number,
	_machineHint: string,
	canonicalFingerprint?: string,
): number[] {
	if (!canonicalFingerprint) return [];
	return rows
		.filter(
			(d) =>
				d.id !== keeperId &&
				d.fingerprint === canonicalFingerprint,
		)
		.map((d) => d.id);
}

export function canonicalFingerprintForRequest(
	userAgent: string,
	osDetected?: string | null,
	deviceId?: string,
	ideName?: string | null,
): string {
	return generateFingerprint('', userAgent, deviceId || '', osDetected, ideName);
}

/** Oldest registered (non-provisional) device by lastSeen then firstSeen. */
export function pickOldestRegistered(rows: DeviceRowLike[]): DeviceRowLike | null {
	const registered = rows.filter(
		(d) => !isProvisionalDevice(d) && !(d.isBlocked ?? d.is_blocked),
	);
	if (!registered.length) return null;
	return [...registered].sort((a, b) => {
		const la = new Date(String(a.lastSeen ?? a.last_seen ?? 0)).getTime();
		const lb = new Date(String(b.lastSeen ?? b.last_seen ?? 0)).getTime();
		if (la !== lb) return la - lb;
		const fa = new Date(String(a.firstSeen ?? a.first_seen ?? 0)).getTime();
		const fb = new Date(String(b.firstSeen ?? b.first_seen ?? 0)).getTime();
		return fa - fb;
	})[0];
}
