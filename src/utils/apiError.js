// apiError — unwrap the server's actual message from an axios rejection.
//
// axios throws an AxiosError whose `.message` is the generic
// "Request failed with status code NNN"; the meaningful text the Rails
// controller returned lives on `.response.data`:
//   { errors: [...] }   (ActiveModel validation failures)
//   { error:  "..." }   (single error string)
//   { message: "..." }  (some endpoints)
//
// Callers that surfaced `e.message` therefore showed the wrong string (or
// nothing useful) on validation errors like 422s.
export function apiErrorMessage(e, fallback = 'Request failed') {
  const d = e?.response?.data
  if (!d) return e?.message || fallback

  if (Array.isArray(d.errors) && d.errors.length) return d.errors.join('; ')
  if (typeof d.error === 'string' && d.error) return d.error
  if (typeof d.message === 'string' && d.message) return d.message

  // Rails sometimes returns a flat { field: [messages] } hash.
  const flat = Object.entries(d)
    .filter(([, v]) => Array.isArray(v))
    .flatMap(([k, v]) => v.map((m) => `${k} ${m}`))
  if (flat.length) return flat.join('; ')

  return e?.message || fallback
}
