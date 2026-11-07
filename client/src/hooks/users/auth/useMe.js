import { getMe } from "@/services/apiUsers";
import { useQuery } from "@tanstack/react-query";

export function useMe() {
    const {
        data,
        isPending: isLoadingMe,
        error: meError,
    } = useQuery({
        queryKey: ["me"],
        queryFn: getMe,
        staleTime: Infinity,
        gcTime: Infinity,
        // Not signed in (401) goes straight to the login page; the default
        // three retries kept a new browser on a spinner for about 8 s.
        retry: (failures, error) => error?.status !== 401 && failures < 3,
    });

    const me = data?.user
    const isAdmin = me?.role === 'admin' || me?.role === "owner"
    const isOwner = me?.role === "owner";
    const isDriver = me?.role === "driver";
    return { me, isAdmin, isOwner, isDriver, isLoadingMe, meError };
}
