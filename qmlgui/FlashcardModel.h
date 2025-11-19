#pragma once

#include <QAbstractListModel>
#include <QString>
#include <QVector>
#include "Flashcard.h"

class FlashcardModel : public QAbstractListModel
{
    Q_OBJECT
    Q_PROPERTY(int count READ rowCount NOTIFY countChanged)
public:
    enum Roles {
        QuestionRole = Qt::UserRole + 1,
        AnswerRole
    };

    explicit FlashcardModel(QObject *parent = nullptr);

    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;

    void setFlashcards(const QVector<Flashcard> &cards);
    const QVector<Flashcard>& flashcards() const { return m_cards; }

signals:
    void countChanged();

public:
    Q_INVOKABLE QString questionAt(int index) const;
    Q_INVOKABLE QString answerAt(int index) const;

private:
    QVector<Flashcard> m_cards;
};
