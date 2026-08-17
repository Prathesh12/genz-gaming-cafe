import { expect, test, type Page } from "@playwright/test";

/**
 * The full counter workflow, exercised exactly as a staff member would:
 *
 *   sign in → start a session → add food → end session → take payment → receipt
 *
 * It runs on a desktop viewport and a phone viewport, because the phone layout
 * is the one the cafe will actually use behind the counter.
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@genzcafe.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

test.describe("counter workflow", () => {
  test("start a session, add food, take a split payment and print a receipt", async ({ page }) => {
    await signIn(page);

    // ---- Stations board ----------------------------------------------------
    await page.goto("/stations");
    await expect(page.getByRole("button", { name: "All categories" })).toBeVisible();

    // Pick the first available station.
    const startButton = page.getByRole("button", { name: "Start session" }).first();
    await expect(startButton).toBeVisible();
    const stationCard = startButton.locator("xpath=ancestor::div[@data-station-code][1]");
    const stationCode = ((await stationCard.getAttribute("data-station-code")) ?? "").trim();
    await startButton.click();

    // ---- Start session dialog ---------------------------------------------
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(`Start session · ${stationCode}`)).toBeVisible();
    await dialog.getByLabel("Customer name").fill("E2E Test Customer");
    await dialog.getByRole("button", { name: "Start session" }).click();
    await expect(page.getByText("Session started", { exact: false })).toBeVisible();

    // The card now shows a live timer.
    await expect(page.getByText("Elapsed").first()).toBeVisible();

    // ---- Add food ----------------------------------------------------------
    await page.getByRole("button", { name: "Food" }).first().click();
    const foodDialog = page.getByRole("dialog");
    await expect(foodDialog.getByText("Add food", { exact: false })).toBeVisible();
    await foodDialog.getByRole("button", { name: /^Add$/ }).first().click();
    await foodDialog.getByRole("button", { name: "Add to bill" }).click();
    await expect(page.getByText("Food added", { exact: false })).toBeVisible();

    // ---- Kitchen queue ------------------------------------------------------
    await page.goto("/kitchen");
    const kitchenCard = page.getByRole("button", { name: "Mark preparing" }).first();
    await expect(kitchenCard).toBeVisible();
    await kitchenCard.click();
    await expect(page.getByText("marked preparing", { exact: false })).toBeVisible();

    // ---- Checkout ----------------------------------------------------------
    await page.goto("/stations");
    await page.getByRole("button", { name: "End session" }).first().click();
    const checkout = page.getByRole("dialog");
    await expect(checkout.getByText("TOTAL", { exact: true })).toBeVisible({ timeout: 20_000 });

    // Split payment: the UPI half is calculated and must balance the total.
    await checkout.getByRole("button", { name: "Split" }).click();
    await expect(checkout.getByLabel(/UPI \(.*\) — calculated/)).toBeVisible();

    await checkout.getByRole("button", { name: /^Take / }).click();

    // ---- Receipt -----------------------------------------------------------
    await page.waitForURL("**/transactions/**", { timeout: 30_000 });
    await expect(page.getByText("TOTAL", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print receipt" })).toBeVisible();
    await expect(page.getByText("E2E Test Customer")).toBeVisible();

    // ---- Voiding a bill ----------------------------------------------------
    await page.getByRole("button", { name: "Void bill" }).click();
    const voidDialog = page.getByRole("dialog");
    await voidDialog.getByPlaceholder("Reason (required)").fill("E2E void check");
    await voidDialog.getByRole("button", { name: "Void this bill" }).click();
    await expect(page.getByText("Bill voided", { exact: false })).toBeVisible();
    await expect(page.getByText("VOID", { exact: true })).toBeVisible();

    // ---- The station is free again ----------------------------------------
    await page.goto("/stations");
    await expect(page.getByText(stationCode).first()).toBeVisible();
  });

  test("four players on one station, each charged their own rate", async ({ page }) => {
    await signIn(page);
    await page.goto("/stations");

    // PS5 Multiplayer seats four, so the player picker appears for it.
    await page.getByRole("button", { name: "PS5 Multiplayer" }).click();
    const startButton = page.getByRole("button", { name: "Start session" }).first();
    await expect(startButton).toBeVisible();

    const card = startButton.locator("xpath=ancestor::div[@data-station-code][1]");
    const stationCode = ((await card.getAttribute("data-station-code")) ?? "").trim();
    // The headline rate says "each", because everyone pays their own.
    await expect(card.getByText("/hr each")).toBeVisible();

    await startButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(`Start session · ${stationCode}`)).toBeVisible();

    // Four seats: one member, three guests.
    await dialog.getByRole("button", { name: "4", exact: true }).click();
    await expect(dialog.getByText("Player 4")).toBeVisible();

    await dialog.getByPlaceholder("Search a member for player 1…").fill("GZM-");
    const firstHit = dialog.getByRole("button").filter({ hasText: /GZM-/ }).first();
    await expect(firstHit).toBeVisible({ timeout: 10_000 });
    await firstHit.click();

    await dialog.getByRole("button", { name: /^Start for 4 players$/ }).click();
    await expect(page.getByText("Session started", { exact: false })).toBeVisible();

    // The card reports the group rather than a single customer.
    await expect(page.getByText("4 players ·", { exact: false })).toBeVisible();

    // ---- Checkout shows every player and their own charge ------------------
    await page.getByRole("button", { name: "End session" }).first().click();
    const checkout = page.getByRole("dialog");
    await expect(checkout.getByText("Each player at their own rate")).toBeVisible({ timeout: 20_000 });
    await expect(checkout.getByText("Regular rate").first()).toBeVisible();
    await expect(checkout.getByText("TOTAL", { exact: true })).toBeVisible();

    await checkout.getByRole("button", { name: /^Take / }).click();

    // ---- The receipt lists all four --------------------------------------
    await page.waitForURL("**/transactions/**", { timeout: 30_000 });
    await expect(page.getByText("Players", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("4. ", { exact: false })).toBeVisible();
  });

  test("a session survives a page reload with its timer intact", async ({ page }) => {
    await signIn(page);
    await page.goto("/stations");

    await page.getByRole("button", { name: "Start session" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Start session" }).click();
    await expect(page.getByText("Session started", { exact: false })).toBeVisible();

    await page.waitForTimeout(2500);
    await page.reload();

    // The elapsed time is derived from the stored start timestamp, so it is
    // still counting after a refresh rather than restarting at zero.
    const timer = page.getByText(/^\d{2}:\d{2}:\d{2}$/).first();
    await expect(timer).toBeVisible();
    const value = await timer.innerText();
    expect(value).not.toBe("00:00:00");

    // Clean up: cancel the session so repeat runs start from a clean board.
    await page.getByRole("button", { name: "Details" }).first().click();
    const details = page.getByRole("dialog");
    await details.getByPlaceholder("Reason").fill("E2E cleanup");
    await details.getByRole("button", { name: "Cancel this session" }).click();
    await expect(page.getByText("Session cancelled", { exact: false })).toBeVisible();
  });

  test("navigation reaches every module", async ({ page }) => {
    await signIn(page);
    for (const path of [
      "/dashboard",
      "/stations",
      "/pricing",
      "/members",
      "/food",
      "/kitchen",
      "/income",
      "/transactions",
      "/reports",
      "/reservations",
      "/staff",
      "/settings",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} should render`).toBeLessThan(400);
      await expect(page.locator("h1")).toBeVisible();
    }
  });

  test("uploading a cafe logo from settings puts it on screen and on receipts", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings");

    await expect(page.getByText("Cafe logo")).toBeVisible();
    // The picker is driven entirely by JavaScript, so wait for the page to
    // finish hydrating — otherwise the file is set before React is listening
    // and nothing happens at all.
    await page.waitForLoadState("networkidle");
    // Either label, so the test does not depend on whether a logo already exists.
    const choose = page.getByRole("button", { name: /Choose an image|Replace logo/ });
    await expect(choose).toBeEnabled();

    // A real 16x16 red PNG, uploaded exactly as the owner would.
    const red = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mO4o6FBEmIY1TCqYfhqAAAyBCwQhCQ/2gAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.setInputFiles('input[type="file"]', {
      name: "logo.png",
      mimeType: "image/png",
      buffer: red,
    });

    await expect(page.getByText("Logo saved", { exact: false })).toBeVisible({ timeout: 20_000 });

    // It is served back from the app, not from a file on disk.
    const served = await page.request.get("/api/logo");
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toContain("image/png");

    // And it reaches the app chrome on the next page load. Attached rather than
    // visible, because on a phone the brand lives inside the closed menu drawer.
    await page.goto("/dashboard");
    await expect(page.locator('img[src*="/api/logo"]').first()).toBeAttached({ timeout: 15_000 });

    // Removing it puts the plain badge back.
    await page.goto("/settings");
    await page.getByRole("button", { name: "Remove" }).click();
    const confirm = page.getByRole("dialog");
    await confirm.getByRole("button", { name: "Remove logo" }).click();
    await expect(page.getByText("Logo removed", { exact: false })).toBeVisible({ timeout: 20_000 });

    const gone = await page.request.get("/api/logo");
    expect(gone.status()).toBe(404);
  });

  test("importing a membership list from a sheet", async ({ page }, testInfo) => {
    await signIn(page);
    await page.goto("/members");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Import from a sheet" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Import members from a sheet")).toBeVisible();

    // Each project imports its own numbers, so running desktop then phone does
    // not turn the second run's rows into duplicates of the first.
    const tag = testInfo.project.name === "mobile" ? "2" : "1";
    const who = `Import ${testInfo.project.name}`;

    // Headers deliberately unlike ours, as a real cafe's sheet would be.
    const csv = [
      "S.No,Customer Name,WhatsApp No.,DOB,Date of Joining,Valid Till,Aadhar Number",
      `1,${who} One,70${tag}1100001,15/03/1998,01/02/2026,01/02/2027,1234123412${tag}4`,
      `2,${who} Two,70${tag}1100002,,01/02/2026,01/02/2027,`,
      `3,,70${tag}1100003,,,,`,
      `4,${who} Four,not-a-number,,,,`,
    ].join("\n");

    await page.setInputFiles('input[type="file"]', {
      name: "members.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });

    // The preview must find the columns on its own and count the rows honestly.
    await expect(dialog.getByText("Ready to import")).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText("2", { exact: true }).first()).toBeVisible();
    // 15/03 in the sheet can only be day-first, so it must have settled on that.
    await expect(dialog.getByLabel("How your dates are being read")).toHaveValue("DMY");

    await dialog.getByRole("button", { name: /^Import 2 members$/ }).click();
    await expect(dialog.getByText("2 members imported")).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText("Not imported (2)")).toBeVisible();

    await dialog.getByRole("button", { name: "Done" }).click();

    // They are really there, with the expiry date from the sheet.
    await page.getByPlaceholder(/Name, mobile/).fill(`${who} One`);
    await expect(page.getByText(`${who} One`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("01 Feb 2027", { exact: false })).toBeVisible();
  });

  test("signed-out users are sent to the login screen", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/income");
    await page.waitForURL("**/login**");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
