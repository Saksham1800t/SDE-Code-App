import React from 'react';
import { ThemeCreator } from './creators/theme/ThemeCreator';
import { SnippetsCreator } from './creators/snippets/SnippetsCreator';

interface PublishFormProps {
  token: string | null;
  user: any;
  onSuccess: (message: string) => void;
  templateType?: 'theme' | 'snippets';
  sourceLanguageId?: string;
}

export const PublishForm: React.FC<PublishFormProps> = ({ token, user, onSuccess, templateType = 'theme', sourceLanguageId }) => {
  if (templateType === 'snippets' && sourceLanguageId) {
    return (
      <SnippetsCreator
        token={token}
        user={user}
        onSuccess={onSuccess}
        languageId={sourceLanguageId}
      />
    );
  }

  return (
    <ThemeCreator
      token={token}
      user={user}
      onSuccess={onSuccess}
    />
  );
};
