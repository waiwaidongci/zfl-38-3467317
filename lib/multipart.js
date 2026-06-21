function parseMultipart(req, boundary) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const result = parseMultipartBuffer(buffer, boundary);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function parseMultipartBuffer(buffer, boundary) {
  const delimiter = Buffer.from('--' + boundary + '\r\n');
  const closeDelimiter = Buffer.from('--' + boundary + '--');
  const parts = [];

  let searchFrom = 0;

  while (searchFrom < buffer.length) {
    const delimIdx = buffer.indexOf(delimiter, searchFrom);
    if (delimIdx === -1) {
      const closeIdx = buffer.indexOf(closeDelimiter, searchFrom);
      if (closeIdx !== -1) break;
      const altCloseIdx = buffer.indexOf(closeDelimiter + '\r\n', searchFrom);
      if (altCloseIdx !== -1) break;
      break;
    }

    const partStart = delimIdx + delimiter.length;

    let partEnd = buffer.indexOf(delimiter, partStart);
    let isClose = false;
    if (partEnd === -1) {
      partEnd = buffer.indexOf(closeDelimiter, partStart);
      isClose = true;
      if (partEnd === -1) {
        partEnd = buffer.indexOf(closeDelimiter + '\r\n', partStart);
        if (partEnd === -1) break;
      }
    }

    let partBuffer = buffer.slice(partStart, partEnd);
    if (partBuffer.length >= 2 && partBuffer[partBuffer.length - 2] === 0x0D && partBuffer[partBuffer.length - 1] === 0x0A) {
      partBuffer = partBuffer.slice(0, -2);
    }

    const part = parsePart(partBuffer);
    if (part) parts.push(part);

    searchFrom = partEnd;
    if (isClose) break;
  }

  return parts;
}

function parsePart(buffer) {
  const sep = Buffer.from('\r\n\r\n');
  const headerEnd = buffer.indexOf(sep);
  if (headerEnd === -1) return null;

  const headerStr = buffer.slice(0, headerEnd).toString('utf8');
  const bodyStart = headerEnd + 4;
  const body = buffer.slice(bodyStart);

  const headers = {};
  headerStr.split('\r\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx !== -1) {
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
  });

  const disposition = headers['content-disposition'];
  if (!disposition) return null;

  const nameMatch = disposition.match(/name="([^"]+)"/);
  const filenameMatch = disposition.match(/filename="([^"]+)"/);

  return {
    name: nameMatch ? nameMatch[1] : null,
    filename: filenameMatch ? filenameMatch[1] : null,
    headers,
    data: body,
    isFile: !!filenameMatch,
  };
}

function extractBoundary(contentType) {
  const match = contentType.match(/boundary=([^;]+)/i);
  return match ? match[1].trim().replace(/^"|"$/g, '') : null;
}

export { parseMultipart, extractBoundary };
