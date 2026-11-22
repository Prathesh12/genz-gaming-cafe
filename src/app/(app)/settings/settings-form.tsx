"use client";

import { useActionState, useEffect } from "react";

import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { toMajor } from "@/lib/money";
import { updateSettingsAction } from "@/server/actions/admin";

export type SettingsValues = {
  cafeName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstNumber: string | null;
  taxEnabled: boolean;
  currencySymbol: string;
  nightStart: string;
  nightEnd: string;
  dayPassEnabled: boolean;
  dayPassMinutes: number;
  membershipDays: number;
  membershipPrice: number;
  membershipExpiryWarningDays: number;
  billingMode: "PER_MINUTE" | "SLAB";
  minimumBillMinutes: number;
  receiptFooter: string;
  invoicePrefix: string;
  timezone: string;
};

export function SettingsForm({ values }: { values: SettingsValues }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateSettingsAction, null);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Settings saved");
      router.refresh();
    } else if (state?.ok === false) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Business details</CardTitle>
          <p className="text-sm text-ink-muted">These appear on every receipt.</p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Cafe name" htmlFor="cafeName" required>
            <Input id="cafeName" name="cafeName" defaultValue={values.cafeName} required />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" defaultValue={values.phone ?? ""} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" defaultValue={values.email ?? ""} />
          </Field>
          <Field label="GST number" htmlFor="gstNumber">
            <Input id="gstNumber" name="gstNumber" defaultValue={values.gstNumber ?? ""} />
          </Field>
          <Field label="Address" htmlFor="address" className="sm:col-span-2">
            <Textarea id="address" name="address" defaultValue={values.address ?? ""} />
          </Field>
          <Field label="Receipt footer" htmlFor="receiptFooter" className="sm:col-span-2">
            <Input id="receiptFooter" name="receiptFooter" defaultValue={values.receiptFooter} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing &amp; time</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="How time is charged"
            htmlFor="billingMode"
            required
            className="sm:col-span-2"
            hint="By the minute charges only for the time actually played: an hour and a quarter on a 100.00 EGP/hr station costs 125.00 EGP. Duration deals charges the cheapest combination of the durations you set in Pricing, which rounds the time up to a whole slab."
          >
            <NativeSelect id="billingMode" name="billingMode" defaultValue={values.billingMode}>
              <option value="PER_MINUTE">By the minute — pay for the time played</option>
              <option value="SLAB">Duration deals — 30 min, 1 hr, 2 hr packages</option>
            </NativeSelect>
          </Field>
          <Field
            label="Night gaming starts"
            htmlFor="nightStart"
            required
            hint="24-hour time. Sessions crossing this boundary are split automatically."
            error={state?.ok === false ? state.fieldErrors?.nightStart : undefined}
          >
            <Input id="nightStart" name="nightStart" type="time" defaultValue={values.nightStart} required />
          </Field>
          <Field label="Night gaming ends" htmlFor="nightEnd" required>
            <Input id="nightEnd" name="nightEnd" type="time" defaultValue={values.nightEnd} required />
          </Field>
          <Field
            label="Timezone"
            htmlFor="timezone"
            required
            hint="IANA name, e.g. Africa/Cairo. Used for today, reports and night bands."
          >
            <Input id="timezone" name="timezone" defaultValue={values.timezone} required />
          </Field>
          <Field label="Currency code" htmlFor="currencySymbol" required>
            <Input id="currencySymbol" name="currencySymbol" defaultValue={values.currencySymbol} maxLength={3} required />
          </Field>
          <Field
            label="Minimum billable minutes"
            htmlFor="minimumBillMinutes"
            hint="Sessions shorter than this are not charged — useful for mistaken starts."
          >
            <Input
              id="minimumBillMinutes"
              name="minimumBillMinutes"
              type="number"
              min={0}
              max={120}
              defaultValue={values.minimumBillMinutes}
            />
          </Field>
          <Field label="Invoice prefix" htmlFor="invoicePrefix" required hint="Receipts read PREFIX-YEAR-NUMBER.">
            <Input id="invoicePrefix" name="invoicePrefix" defaultValue={values.invoicePrefix} maxLength={6} required />
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="taxEnabled" defaultChecked={values.taxEnabled} className="size-4 accent-[#F5C518]" />
            Charge tax on food items
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Day pass &amp; memberships</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
            <input
              type="checkbox"
              name="dayPassEnabled"
              defaultChecked={values.dayPassEnabled}
              className="size-4 accent-[#F5C518]"
            />
            Offer day passes (applied automatically when cheaper than slabs)
          </label>
          <Field label="Day pass validity (minutes)" htmlFor="dayPassMinutes" required>
            <Input
              id="dayPassMinutes"
              name="dayPassMinutes"
              type="number"
              min={30}
              max={1440}
              defaultValue={values.dayPassMinutes}
              required
            />
          </Field>
          <Field label="Membership length (days)" htmlFor="membershipDays" required>
            <Input
              id="membershipDays"
              name="membershipDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={values.membershipDays}
              required
            />
          </Field>
          <Field label="Default membership price" htmlFor="membershipPrice" required>
            <Input
              id="membershipPrice"
              name="membershipPrice"
              type="number"
              step="0.01"
              min={0}
              defaultValue={toMajor(values.membershipPrice)}
              required
            />
          </Field>
          <Field
            label="Expiry warning (days)"
            htmlFor="membershipExpiryWarningDays"
            hint="Dashboard warns this many days before a membership lapses."
            required
          >
            <Input
              id="membershipExpiryWarningDays"
              name="membershipExpiryWarningDays"
              type="number"
              min={1}
              max={180}
              defaultValue={values.membershipExpiryWarningDays}
              required
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" size="lg" loading={pending}>
          <Save aria-hidden />
          Save settings
        </Button>
      </div>
    </form>
  );
}
