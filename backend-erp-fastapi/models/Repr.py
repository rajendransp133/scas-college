from sqlalchemy.inspection import inspect

class Repr:
    def __repr__(self):
        mapper = inspect(self.__class__)
        attrs = ', '.join(
            f"{col.name}={getattr(self, col.name)!r}" 
            for col in mapper.columns
        )
        return f"<{self.__class__.__name__}({attrs})>"