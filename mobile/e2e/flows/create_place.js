// Plays the web app's part in 06_places_listed: logs in as the test user and
// creates one enabled place and one paused one, in their first time category.
//
// Like revoke_all_devices.js it calls Flask directly on the backend network
// (NAMU_FLASK), which spares it the cookie dance the web proxies expect.
function call(method, path, token, body) {
  const options = { headers: { "Content-Type": "application/json" } };
  if (token) options.headers.Authorization = `Bearer ${token}`;
  if (method !== "GET") options.body = JSON.stringify(body || {});
  const response = method === "GET"
    ? http.get(`${NAMU_FLASK}${path}`, options)
    : http.post(`${NAMU_FLASK}${path}`, options);
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`${method} ${path} answered ${response.status}: ${response.body}`);
  }
  return json(response.body);
}

const token = call("POST", "/login", null, {
  username: NAMU_USER,
  password: NAMU_PASSWORD,
}).access_token;

const category = call("GET", "/get/categories", token).categories[0];
function place(name, radius, enabled) {
  return {
    name: name,
    category_id: category.id,
    latitude: -23.561414,
    longitude: -46.655881,
    radius_m: radius,
    enabled: enabled,
  };
}

call("POST", "/places", token, place("Office", 200, true));
call("POST", "/places", token, place("Holiday home", 150, false));
output.category = category.name;
