const { execFileSync } = require('node:child_process');
const dns = require('node:dns');
const mongoose = require('mongoose');

const isOptionalTxtError = (error) => ['ENODATA', 'ENOTFOUND'].includes(error?.code);

const queryDns = (resolver, method, hostname) =>
  new Promise((resolve) => {
    resolver[method](hostname, (error, records) => resolve({ error, records }));
  });

const getWindowsDnsServers = () => {
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-DnsClientServerAddress | ForEach-Object { $_.ServerAddresses }) -join "`n"',
    ],
    { encoding: 'utf8', timeout: 5000, windowsHide: true }
  );

  return output
    .split(/\r?\n/)
    .map((server) => server.trim())
    .filter(Boolean);
};

const canResolveAtlas = async (resolver, hostname) => {
  const srv = await queryDns(resolver, 'resolveSrv', `_mongodb._tcp.${hostname}`);
  if (srv.error || !srv.records?.length) return false;

  const txt = await queryDns(resolver, 'resolveTxt', hostname);
  return !txt.error || isOptionalTxtError(txt.error);
};

const configureAtlasDns = async (hostname) => {
  const defaultResolver = new dns.Resolver();
  if (await canResolveAtlas(defaultResolver, hostname)) return;

  if (process.platform !== 'win32') {
    throw new Error('Node.js could not resolve the MongoDB Atlas SRV/TXT records using the configured DNS resolver.');
  }

  let windowsServers;
  try {
    windowsServers = getWindowsDnsServers();
  } catch {
    throw new Error('Node.js could not resolve MongoDB Atlas DNS, and the configured Windows DNS resolvers could not be checked.');
  }

  const candidates = [...new Set([...dns.getServers(), ...windowsServers])];
  for (const server of candidates) {
    const resolver = new dns.Resolver();
    try {
      resolver.setServers([server]);
      if (await canResolveAtlas(resolver, hostname)) {
        dns.setServers([server]);
        console.warn(
          '⚠️ [Database]: Node.js default DNS could not resolve Atlas records; using a verified Windows DNS resolver for this process.'
        );
        return;
      }
    } catch {
      // Skip DNS servers that are invalid or unreachable; only use one that passed both record checks.
    }
  }

  throw new Error(
    'MongoDB Atlas SRV/TXT DNS lookups failed with Node.js and all configured Windows DNS resolvers. Check VPN/network DNS settings.'
  );
};

/**
 * Connect to MongoDB database
 * Supports both MongoDB Atlas cloud clusters and local MongoDB instances.
 */
const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI is not set. Add your MongoDB Atlas connection string to backend/.env.');
  }

  try {
    const parsedUri = new URL(mongoUri);
    if (parsedUri.protocol === 'mongodb+srv:') {
      await configureAtlasDns(parsedUri.hostname);
    }

    await mongoose.connect(mongoUri, { dbName: 'yemelstore' });
    console.log(`✅ [Database]: MongoDB connection established to "${mongoose.connection.name}".`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    if (/querySrv\s+ECONNREFUSED/i.test(detail)) {
      throw new Error(
        'MongoDB Atlas DNS SRV lookup was refused by the configured DNS resolver. Use a resolver that permits Atlas SRV queries, then retry.',
        { cause: error }
      );
    }

    const safeDetail = detail.replace(
      /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi,
      '[redacted MongoDB connection string]'
    );
    throw new Error(`MongoDB connection failed: ${safeDetail}`, { cause: error });
  }
};

module.exports = connectDB;
