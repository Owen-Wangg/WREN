import { useQuery } from '@tanstack/react-query';
import { getUploadConfig } from '@/features/dashboard/dashboardApi';
import { useApiClient } from '@/services/apiClient';
import { queryKeys } from './queryKeys';

const DEFAULT_MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;

export function useUploadConfig() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.uploadConfig(),
    queryFn: () => getUploadConfig(client),
    staleTime: 5 * 60 * 1000,
    // Fall back to the default so the component is never blocked waiting for the query.
    placeholderData: { maxFileSizeBytes: DEFAULT_MAX_FILE_SIZE_BYTES },
  });
}
