"use client";

import type {
  ListQuery,
  StaffAccessLink,
  StaffInvite,
  StaffUpdate,
} from "@esim-erp/contracts";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState } from "react";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  createStaffAccessLink,
  inviteStaff,
  listStaff,
  setStaffPassword,
  updateStaff,
} from "@/services/staff";

export function useStaff(query: ListQuery) {
  return useQuery({
    queryKey: [...QUERY_KEYS.staff, "list", query],
    queryFn: ({ signal }) => listStaff(query, signal),
    placeholderData: keepPreviousData,
    staleTime: 10000,
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: StaffUpdate }) =>
      updateStaff(id, values),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.staff }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit }),
      ]),
  });
}

// Passwords and access links must bypass both query and mutation caches.
function useEphemeralRequest<Input, Result>(
  execute: (input: Input) => Promise<Result>,
) {
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);

  async function submit(input: Input): Promise<Result> {
    if (pending.current) throw new Error("Permintaan masih diproses.");

    pending.current = true;
    setIsPending(true);

    try {
      return await execute(input);
    } finally {
      pending.current = false;
      setIsPending(false);
    }
  }

  return { isPending, submit };
}

type StaffAccessLinkInput =
  | { readonly kind: "invite"; readonly values: StaffInvite }
  | { readonly kind: "replace"; readonly id: string };

export function useCreateStaffAccessLink() {
  const queryClient = useQueryClient();

  return useEphemeralRequest(
    async (input: StaffAccessLinkInput): Promise<StaffAccessLink> => {
      const link =
        input.kind === "invite"
          ? await inviteStaff(input.values)
          : await createStaffAccessLink(input.id);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.staff }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.audit }),
      ]);

      return link;
    },
  );
}

export function useSetStaffPassword() {
  return useEphemeralRequest(setStaffPassword);
}
