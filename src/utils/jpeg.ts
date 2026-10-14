import { z } from "zod";
import { AppError } from "../errors/AppError";

// Foto enviada pelo site: JPEG em data URL base64 (o próprio site já recorta e reduz a imagem)
export const jpegDataUrl = z
  .string()
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/, "Envie a foto em JPEG");

// Converte a data URL em bytes, conferindo o tamanho e se o arquivo é mesmo um JPEG
export function jpegFromDataUrl(dataUrl: string, maxBytes: number) {
  const data = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");

  if (data.length > maxBytes) {
    throw new AppError("A foto é grande demais", 413);
  }
  // Todo JPEG começa com os bytes FF D8 FF
  if (data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) {
    throw new AppError("O arquivo enviado não é uma imagem JPEG válida", 400);
  }

  return data;
}
