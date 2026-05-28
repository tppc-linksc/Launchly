import { Injectable } from '@nestjs/common';

@Injectable()
export class EditionConfig {
  private readonly edition = process.env.LAUNCHLY_EDITION || 'selfhost';

  getEdition(): string {
    return this.edition;
  }

  isCloud(): boolean {
    return this.edition === 'cloud';
  }

  isSelfHost(): boolean {
    return !this.isCloud();
  }
}
