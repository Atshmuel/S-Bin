import { SERVER_URL } from "@/utils/constants";

// Calls the API with the session cookie and returns the JSON reply; a failed
// request throws with the server's message (and the status, as error.status).
export async function request(path, { method = "GET", body } = {}) {
    const res = await fetch(`${SERVER_URL}/${path}`, {
        method,
        credentials: "include",
        ...(body === undefined
            ? {}
            : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data?.message || "Request failed."), { status: res.status });
    return data;
}
