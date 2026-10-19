import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Corps JSON illisible : message générique. Le détail de l'analyseur (« Expected property name… at position 1 ») renseigne sur la
 * technologie sans aider l'utilisateur ; les erreurs de validation (champs) gardent leur message.
 */
@Catch(BadRequestException)
export class RequeteInvalideFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const reponse = host.switchToHttp().getResponse<Response>();
    const corps = exception.getResponse();
    const message = typeof corps === 'object' && corps !== null ? (corps as { message?: unknown }).message : corps;
    const illisible = typeof message === 'string' && /JSON|position \d+|Unexpected token|Expected property/i.test(message);
    reponse.status(400).json(illisible ? { message: 'Requête invalide.', error: 'Bad Request', statusCode: 400 } : corps);
  }
}
