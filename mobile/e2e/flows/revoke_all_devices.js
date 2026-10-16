// Plays the web app's part in 05_revoked_from_web: logs in as the test user and
// revokes every phone they have paired.
//
// It calls Flask directly. The web-side device routes (/devices and
// /devices/<id>/revoke) get their Next.js proxy and page in phase 5; until then
// this stands in for them, which is why the emulator container also joins the
// backend network. NAMU_FLASK is Flask's address on that network.
function call(method, path, token, body) {
  const options = { headers: { "Content-Type": "application/json" } };
  if (token) options.headers.Authorization = `Bearer ${token}`;
  // Maestro's http.post refuses a POST without a body, so a bodiless one sends
  // an empty object; the revoke route ignores it.
  if (method !== "GET") options.body = JSON.stringify(body || {});
  const response = method === "GET"
    ? http.get(`${NAMU_FLASK}${path}`, options)
    : http.post(`${NAMU_FLASK}${path}`, options);
  if (response.status !== 200) {
    throw new Error(`${method} ${path} answered ${response.status}: ${response.body}`);
  }
  return json(response.body);
}

const token = call("POST", "/login", null, {
  username: NAMU_USER,
  password: NAMU_PASSWORD,
}).access_token;

const devices = call("GET", "/devices", token).devices;
for (const device of devices) {
  call("POST", `/devices/${device.id}/revoke`, token);
}
output.revoked = devices.length;
