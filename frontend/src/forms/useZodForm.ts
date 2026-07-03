/**
 * `useZodForm` — the standard way to build forms in WREN: React Hook Form driven
 * by a Zod schema (frontend steering §9 / task 17.1). Validation schemas live
 * alongside the form and run at the API boundary, so inputs are validated with
 * the same Zod contracts used for API payloads rather than scattered inline
 * checks.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useForm,
  type UseFormProps,
  type UseFormReturn,
} from 'react-hook-form';
import type { ZodType } from 'zod';

export function useZodForm<TSchema extends ZodType>(
  schema: TSchema,
  options?: Omit<UseFormProps<TSchema['_input']>, 'resolver'>,
): UseFormReturn<TSchema['_input'], unknown, TSchema['_output']> {
  return useForm<TSchema['_input'], unknown, TSchema['_output']>({
    ...options,
    resolver: zodResolver(schema),
  });
}
