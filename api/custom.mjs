/**
 * Hook point for custom API behavior.
 * Return true from handleCustom when the request is fully handled.
 */
export async function handleCustom(_req, _res, _path, _readBody) {
  return false;
}
