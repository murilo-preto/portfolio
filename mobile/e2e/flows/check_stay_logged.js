// The last step of 07_geofence_stay: the stay the emulator walked through must
// now be an ordinary time entry, in Office's category, noted as Namu's.
//
// Calls Flask directly on the backend network, like the other scripts here.
function call(method, path, token) {
  const options = { headers: { "Content-Type": "application/json" } };
  if (token) options.headers.Authorization = `Bearer ${token}`;
  if (method !== "GET") {
    options.body = JSON.stringify({ username: NAMU_USER, password: NAMU_PASSWORD });
  }
  const response = method === "GET"
    ? http.get(`${NAMU_FLASK}${path}`, options)
    : http.post(`${NAMU_FLASK}${path}`, options);
  if (response.status !== 200) {
    throw new Error(`${method} ${path} answered ${response.status}: ${response.body}`);
  }
  return json(response.body);
}

const token = call("POST", "/login").access_token;
const office = call("GET", "/places", token).places.filter(function (p) {
  return p.name === "Office";
})[0];
const logged = call("GET", "/entry", token).entries.filter(function (e) {
  return e.note === "Namu: Office";
});

if (logged.length !== 1) {
  throw new Error(`Expected one entry noted "Namu: Office", found ${logged.length}`);
}
if (logged[0].category !== office.category) {
  throw new Error(`Logged in ${logged[0].category}, expected ${office.category}`);
}
output.entry = logged[0];
