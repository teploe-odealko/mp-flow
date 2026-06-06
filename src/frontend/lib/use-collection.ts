import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api";

/**
 * Точечный доступ к одной коллекции через ресурсный API.
 * Возвращает сырые данные (массив или объект) — на месте вызова, как и раньше,
 * добавляется `?? []` / `?? {}`. React Query кэширует по ["collection", name],
 * поэтому переходы между страницами переиспользуют уже загруженное.
 *
 * Это шаг ухода фронта от god-snapshot: каждая страница тянет ровно те ресурсы,
 * которые ей нужны, а не весь стейт целиком.
 */
export function useCollection<T = any>(name: string): T | undefined {
  const query = useQuery({
    queryKey: ["collection", name],
    queryFn: () => apiGet<T>(`/api/collections/${name}`)
  });
  return query.data;
}
