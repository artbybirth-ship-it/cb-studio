import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const ADMIN_LOGIN_ID = "admin";
export const ADMIN_PASSWORD = "CBStudio@2026";

const COOKIE_NAME = "cb_admin_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

const EXPECTED_LOGIN = digest(ADMIN_LOGIN_ID);
const EXPECTED_PASSWORD = digest(ADMIN_PASSWORD);
const SESSION_TOKEN = createHash("sha256")
  .update(`${ADMIN_LOGIN_ID}:${ADMIN_PASSWORD}:characterbazaar-studio-v104-admin`, "utf8")
  .digest("hex");

export function verifyAdminCredentials(loginId: string, password: string): boolean {
  const login = digest(String(loginId || ""));
  const pass = digest(String(password || ""));
  return timingSafeEqual(login, EXPECTED_LOGIN) && timingSafeEqual(pass, EXPECTED_PASSWORD);
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const jar = await cookies();
  const value = jar.get(COOKIE_NAME)?.value || "";
  const actual = digest(value);
  const expected = digest(SESSION_TOKEN);
  return timingSafeEqual(actual, expected);
}

export async function createAdminSession(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, SESSION_TOKEN, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearAdminSession(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
    maxAge: 0,
  });
}
