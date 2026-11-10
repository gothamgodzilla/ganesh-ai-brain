/**
 * Ganesh trust attestation as a standard JWS (ES256 via jose) instead of
 * hand-rolled crypto. JWS gives canonical encoding, a key id for rotation,
 * and an enforced expiry — any standard JOSE library can verify a proof.
 */
import { SignJWT, jwtVerify } from 'jose';

export const PROOF_TYPE = 'GANESH_V1_ACTIVE_BUSINESS_PROOFOFSTATUS';
const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60; // status attestations go stale

export class GaneshAuthenticationSystem {
  /**
   * @param {object} options
   * @param {CryptoKey|import('node:crypto').KeyObject} options.privateKey ES256 (P-256) private key.
   * @param {string} options.keyId Identifies the signing key so proofs
   *   remain verifiable across key rotations.
   * @param {number} [options.ttlSeconds] Proof lifetime; default 90 days.
   */
  constructor({ privateKey, keyId, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
    if (!privateKey || !keyId) {
      throw new Error('GaneshAuthenticationSystem requires privateKey and keyId');
    }
    this.privateKey = privateKey;
    this.keyId = keyId;
    this.ttlSeconds = ttlSeconds;
  }

  /**
   * Mint a signed proof of active business status.
   * @param {{entityId: string, legalName: string, sosStatus: string,
   *          source?: string, retrievedAt?: string}} attestation
   *   Pass the SOS verifier's provenance fields so the proof cites its
   *   evidence; a proof of status is only as good as its citation.
   * @returns {Promise<string>} Compact JWS.
   */
  async mintTrustProof(attestation) {
    for (const field of ['entityId', 'legalName', 'sosStatus']) {
      if (!attestation?.[field]) {
        throw new Error(`mintTrustProof: missing required field '${field}'`);
      }
    }
    return new SignJWT({ proof_type: PROOF_TYPE, attestation })
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId, typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.privateKey);
  }
}

/**
 * Verify a minted proof. Signature, expiry, and proof type are all enforced;
 * expired or foreign tokens throw.
 * @returns {Promise<{payload: object, keyId: string}>}
 */
export async function verifyTrustProof(token, publicKey) {
  const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
    algorithms: ['ES256'],
  });
  if (payload.proof_type !== PROOF_TYPE) {
    throw new Error(`Unexpected proof_type: ${payload.proof_type}`);
  }
  return { payload, keyId: protectedHeader.kid };
}
