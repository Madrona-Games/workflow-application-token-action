export class PrivateKey {
  private readonly _key: string;

  constructor(data: string) {
    if (isRsaPrivateKey(data)) {
      this._key = data;
      return;
    }

    // Try to decode as Base64 key
    const decoded = decodeData(data);
    if (decoded) {
      this._key = decoded;
      return;
    }

    throw new Error(
      'Unsupported private key data format, need raw key in PEM format or Base64 encoded string.'
    );
  }

  get key(): string {
    return this._key;
  }
}

function decodeData(data: string): string | null {
  const decoded = Buffer.from(data, 'base64').toString('ascii');

  if (isRsaPrivateKey(decoded)) {
    return decoded;
  }

  return null;
}

function isRsaPrivateKey(data: string): boolean {
  const possibleKey = `${data}`.trim();
  return (
    possibleKey.startsWith("-----BEGIN RSA PRIVATE KEY-----") &&
    possibleKey.endsWith("-----END RSA PRIVATE KEY-----")
  );
}
