import { useQuery } from '@tanstack/react-query';
import { getUploadConfig } from '@/features/dashboard/dashboardApi';
import { useApiClient } from '@/services/apiClient';
import { queryKeys } from './queryKeys';

const DEFAULT_MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;
const DEFAULT_MAX_WORD_COUNT = 10_000;

export function useUploadConfig() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.uploadConfig(),
    queryFn: () => getUploadConfig(client),
    staleTime: 5 * 60 * 1000,
    // Fall back to the defaults so components are never blocked waiting for the query.
    placeholderData: {
      maxFileSizeBytes: DEFAULT_MAX_FILE_SIZE_BYTES,
      maxWordCount: DEFAULT_MAX_WORD_COUNT,
    },
  });
}
