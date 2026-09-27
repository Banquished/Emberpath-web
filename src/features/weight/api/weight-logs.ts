import { env } from "@/app/config/env";
import type { WeightLog, WeightLogInput } from "@/entities/weight-log";
import type {
  RollingAverageWindow,
  WeightRollingAverage,
} from "@/entities/weight-rolling-average";
import type { WeightSummary } from "@/entities/weight-summary";
import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  readWeightJson,
  requestWeight,
  type GetWeightToken,
} from "./weight-request";

const baseUrl = `${env.apiBaseUrl.replace(/\/$/, "")}/weight-logs`;
const serviceError =
  "The weight service could not complete the request. Please try again.";

async function weightLogResponse(
  getToken: GetWeightToken,
  path = "",
  options?: RequestInit,
): Promise<Response> {
  const response = await requestWeight(getToken, `${baseUrl}${path}`, options);
  if (!response.ok) {
    const method = options?.method ?? "GET";
    if ((method === "PATCH" || method === "DELETE") && response.status === 403)
      throw new Error("You do not have access to this measurement.");
    if ((method === "POST" || method === "PATCH") && response.status === 409)
      throw new Error(
        "A measurement already exists for this date. Edit that entry or choose another date.",
      );
    if ((method === "PATCH" || method === "DELETE") && response.status === 404)
      throw new Error(
        "This measurement no longer exists. Refresh the history and try again.",
      );
    if ((method === "POST" || method === "PATCH") && response.status === 422)
      throw new Error(
        "Check the date and weight. Weight must be positive, below 10,000 kg, with at most two decimal places.",
      );
    if (method === "GET" && response.status === 422) {
      if (path === "/summary" || path.startsWith("/summary?"))
        throw new Error("Check the selected date range and try again.");
      if (path === "/rolling-average" || path.startsWith("/rolling-average?"))
        throw new Error(
          "Check the selected date range or rolling average window and try again.",
        );
    }
    throw new Error(serviceError);
  }
  return response;
}

async function requestJson<T>(
  getToken: GetWeightToken,
  path = "",
  options?: RequestInit,
): Promise<T> {
  return readWeightJson<T>(
    await weightLogResponse(getToken, path, options),
    serviceError,
  );
}

export function useWeightLogs() {
  const { getToken, userId, sessionId, isLoaded, isSignedIn } = useAuth();
  return useQuery({
    queryKey: ["weight-logs", userId, sessionId],
    queryFn: ({ signal }) => requestJson<WeightLog[]>(getToken, "", { signal }),
    enabled: isLoaded && isSignedIn,
    retry: false,
  });
}

export function useWeightSummary(start?: string, end?: string) {
  const { getToken, userId, sessionId, isLoaded, isSignedIn } = useAuth();
  const params = new URLSearchParams();
  if (start) params.set("start_date", start);
  if (end) params.set("end_date", end);
  const query = params.toString();
  return useQuery({
    queryKey: ["weight-logs", userId, sessionId, "summary", start, end],
    queryFn: ({ signal }) =>
      requestJson<WeightSummary>(getToken, `/summary${query ? `?${query}` : ""}`, {
        signal,
      }),
    enabled: isLoaded && isSignedIn,
    retry: false,
  });
}

export function useWeightRollingAverage(
  start?: string,
  end?: string,
  windowDays: RollingAverageWindow = 7,
) {
  const { getToken, userId, sessionId, isLoaded, isSignedIn } = useAuth();
  const params = new URLSearchParams();
  if (start) params.set("start_date", start);
  if (end) params.set("end_date", end);
  params.set("window_days", String(windowDays));
  const query = params.toString();
  return useQuery({
    queryKey: [
      "weight-logs",
      userId,
      sessionId,
      "rolling-average",
      start,
      end,
      windowDays,
    ],
    queryFn: ({ signal }) =>
      requestJson<WeightRollingAverage>(
        getToken,
        `/rolling-average${query ? `?${query}` : ""}`,
        { signal },
      ),
    enabled: isLoaded && isSignedIn,
    retry: false,
  });
}

export function useSaveWeightLog() {
  const { getToken, userId, sessionId } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["weight-logs", userId, sessionId],
    mutationFn: ({ id, input }: { id?: string; input: WeightLogInput }) =>
      requestJson<WeightLog>(getToken, id ? `/${id}` : "", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["weight-logs", userId, sessionId],
      }),
  });
}

export function useDeleteWeightLog() {
  const { getToken, userId, sessionId } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["weight-logs", userId, sessionId],
    mutationFn: async (id: string) => {
      await weightLogResponse(getToken, `/${id}`, { method: "DELETE" });
    },
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["weight-logs", userId, sessionId],
      }),
  });
}
