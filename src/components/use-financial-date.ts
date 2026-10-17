"use client";

import { useEffect, useState } from "react";
import { TODAY } from "@/lib/domain";
import { financialDate } from "@/lib/finance/engine";

/** Same initial date on server/client; refresh the financial day after hydration. */
export function useFinancialDate(financialState: unknown) {
  const [date, setDate] = useState(TODAY);
  useEffect(() => {
    setDate(financialDate());
  }, [financialState]);
  useEffect(() => {
    const refresh = () => setDate(financialDate());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return date;
}
